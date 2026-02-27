#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

const DEFAULTS = {
  guests: 500,
  questions: 10,
  registerConcurrency: 50,
  connectConcurrency: 40,
  answerConcurrency: 100,
  reportDir: "./loadtest/reports",
  reportPrefix: "load-test",
  socketConnectTimeoutMs: 20_000,
  wsConnectRetries: 3,
  wsConnectRetryDelayMs: 250,
  minConnectedRatio: 1
};

let ioFactory = null;
const activeSockets = new Set();
const activeIntervals = new Set();
let exiting = false;

function trackSocket(socket) {
  if (socket) activeSockets.add(socket);
  return socket;
}

function trackInterval(intervalId) {
  if (intervalId) activeIntervals.add(intervalId);
  return intervalId;
}

function untrackInterval(intervalId) {
  if (!intervalId) return;
  activeIntervals.delete(intervalId);
}

function cleanupRuntimeHandles() {
  for (const intervalId of [...activeIntervals]) {
    try {
      clearInterval(intervalId);
    } catch {}
    activeIntervals.delete(intervalId);
  }
  for (const socket of [...activeSockets]) {
    try {
      socket.disconnect();
    } catch {}
    activeSockets.delete(socket);
  }
}

function exitNow(code = 0) {
  if (exiting) return;
  exiting = true;
  cleanupRuntimeHandles();
  process.exit(code);
}

async function getSocketIoFactory() {
  if (ioFactory) return ioFactory;
  try {
    const mod = await import("socket.io-client");
    ioFactory = mod.io;
    return ioFactory;
  } catch (err) {
    throw new Error(
      `socket.io-client is missing. Run "npm --prefix loadtest install" or use "bash loadtest/run.sh ...". (${err?.code || err?.message || err})`
    );
  }
}

function printUsage() {
  const text = `
Quizduell load test

Usage:
  node loadtest/load-test.mjs --url <baseUrlOrApiUrl> --admin-token <ADMIN_TOKEN> [options]

Required:
  --url                  App URL, e.g. http://localhost:8080 or http://localhost:3000/api
  --admin-token          Master admin login secret (ADMIN_TOKEN from backend env)

Options:
  --guests <n>           Single run guest count (default: ${DEFAULTS.guests})
  --guest-counts <list>  Multi-run guest counts, comma separated (example: 100,250,500)
  --questions <n>        Number of generated sample questions (default: ${DEFAULTS.questions})
  --register-concurrency <n>
  --connect-concurrency <n>
  --answer-concurrency <n>
  --socket-timeout-ms <n>  Socket connect timeout per attempt (default: ${DEFAULTS.socketConnectTimeoutMs})
  --ws-connect-retries <n> WebSocket connect retries per guest (default: ${DEFAULTS.wsConnectRetries})
  --ws-retry-delay-ms <n>  Base retry delay for websocket reconnect attempts (default: ${DEFAULTS.wsConnectRetryDelayMs})
  --min-connected-ratio <n> Required guest websocket ratio 0..1 (default: ${DEFAULTS.minConnectedRatio})
  --report <path>        JSON report output path (optional override)
  --report-dir <path>    Report directory (default: ${DEFAULTS.reportDir})
  --report-prefix <name> Report filename prefix (default: ${DEFAULTS.reportPrefix})
  --help
`;
  console.log(text.trim());
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function asPositiveInt(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v > 0 ? v : fallback;
}

function asRatio(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function parseGuestCounts(rawSingle, rawList) {
  if (rawList) {
    const values = String(rawList)
      .split(",")
      .map((s) => asPositiveInt(s.trim(), 0))
      .filter((n) => n > 0);
    if (values.length) return values;
  }
  return [asPositiveInt(rawSingle, DEFAULTS.guests)];
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function joinUrl(base, relPath) {
  const left = trimTrailingSlash(base);
  const right = String(relPath || "").replace(/^\/+/, "");
  return `${left}/${right}`;
}

function normalizeBaseUrls(rawUrl) {
  const parsed = new URL(String(rawUrl));
  const normalizedPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  const origin = parsed.origin;

  let prefixPath = normalizedPath;
  let apiPath = "";

  if (normalizedPath.endsWith("/api")) {
    prefixPath = normalizedPath.slice(0, -4);
    apiPath = normalizedPath || "/api";
  } else {
    apiPath = `${normalizedPath}/api`;
  }

  const safePrefix = prefixPath || "";
  const safeApiPath = apiPath || "/api";

  return {
    apiBaseUrl: `${origin}${safeApiPath}`,
    socketBaseUrl: `${origin}${safePrefix}`,
    socketPath: `${safePrefix || ""}/socket.io`.replace(/\/{2,}/g, "/")
  };
}

async function isRunningInDocker() {
  try {
    await fs.access("/.dockerenv");
    return true;
  } catch {
    return false;
  }
}

function rewriteLoopbackUrlForDocker(rawUrl) {
  const parsed = new URL(String(rawUrl));
  const host = String(parsed.hostname || "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    return { rewritten: false, url: String(rawUrl) };
  }
  parsed.hostname = "host.docker.internal";
  return { rewritten: true, url: parsed.toString() };
}

function nowIso() {
  return new Date().toISOString();
}

function logLine(message) {
  console.log(`[${nowIso()}] ${message}`);
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function stampForFileName(iso) {
  const raw = String(iso || nowIso());
  return raw.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "").replace(/[^0-9_-]/g, "");
}

function safeFilePart(raw, fallback) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return cleaned || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function fmtMs(value) {
  return `${round2(value)} ms`;
}

function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function randomFrom(array) {
  if (!Array.isArray(array) || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

function questionOptions(question) {
  if (Array.isArray(question?.Options)) return question.Options;
  if (Array.isArray(question?.options)) return question.options;
  return [];
}

function buildRandomAnswer(question) {
  const type = String(question?.type || "choice").toLowerCase();
  const options = questionOptions(question);
  const optionIds = options.map((o) => String(o.id)).filter(Boolean);

  if (type === "estimate") {
    const target = Number(question?.estimateTarget);
    const spread = Number.isFinite(target) ? Math.max(5, Math.round(Math.abs(target) * 0.25)) : 25;
    const base = Number.isFinite(target) ? target : 50;
    const guess = Math.round(base + ((Math.random() * 2 - 1) * spread));
    return {
      optionIds: [String(guess)],
      value: String(guess)
    };
  }

  if (type === "order") {
    const shuffled = shuffle(optionIds);
    return { optionIds: shuffled };
  }

  if (!optionIds.length) return { optionIds: [] };

  if (question?.allowMultiple) {
    const picked = optionIds.filter(() => Math.random() < 0.45);
    if (!picked.length) {
      const fallback = randomFrom(optionIds);
      return { optionIds: fallback ? [fallback] : [] };
    }
    return { optionIds: [...new Set(picked)] };
  }

  const one = randomFrom(optionIds);
  return { optionIds: one ? [one] : [] };
}

function createExampleQuestions(count) {
  const templates = [
    {
      text: "Which color is shown most often in your logo?",
      type: "choice",
      allowMultiple: false,
      blockLabel: "Warmup",
      options: [
        { text: "Red", isCorrect: true, orderIndex: 0 },
        { text: "Blue", isCorrect: false, orderIndex: 1 },
        { text: "Green", isCorrect: false, orderIndex: 2 },
        { text: "Yellow", isCorrect: false, orderIndex: 3 }
      ]
    },
    {
      text: "Risk: Which deployment type is most stable?",
      type: "risk",
      allowMultiple: false,
      blockLabel: "Risk",
      options: [
        { text: "Canary rollout", isCorrect: true, orderIndex: 0 },
        { text: "Big bang release", isCorrect: false, orderIndex: 1 },
        { text: "Manual copy to prod", isCorrect: false, orderIndex: 2 }
      ]
    },
    {
      text: "Estimate: How many seconds are in one hour?",
      type: "estimate",
      blockLabel: "Numbers",
      estimateTarget: 3600,
      estimateTolerance: 100,
      options: []
    },
    {
      text: "Sort a normal code review flow.",
      type: "order",
      allowMultiple: true,
      blockLabel: "Flow",
      options: [
        { text: "Open pull request", orderIndex: 0 },
        { text: "Review comments", orderIndex: 1 },
        { text: "Apply fixes", orderIndex: 2 },
        { text: "Merge", orderIndex: 3 }
      ]
    },
    {
      text: "Choose all backend runtimes used in this project.",
      type: "choice",
      allowMultiple: true,
      blockLabel: "Project",
      options: [
        { text: "Node.js", isCorrect: true, orderIndex: 0 },
        { text: "MariaDB", isCorrect: true, orderIndex: 1 },
        { text: "COBOL", isCorrect: false, orderIndex: 2 },
        { text: "Pascal", isCorrect: false, orderIndex: 3 }
      ]
    },
    {
      text: "Which protocol carries the live updates?",
      type: "choice",
      allowMultiple: false,
      blockLabel: "Realtime",
      options: [
        { text: "WebSocket / Socket.IO", isCorrect: true, orderIndex: 0 },
        { text: "FTP", isCorrect: false, orderIndex: 1 },
        { text: "SMTP", isCorrect: false, orderIndex: 2 }
      ]
    },
    {
      text: "Risk: Which action can rollback easiest?",
      type: "risk",
      allowMultiple: false,
      blockLabel: "Risk",
      options: [
        { text: "Feature flag off", isCorrect: true, orderIndex: 0 },
        { text: "Drop production schema", isCorrect: false, orderIndex: 1 },
        { text: "Delete all containers", isCorrect: false, orderIndex: 2 }
      ]
    },
    {
      text: "Estimate: Number of minutes in a day?",
      type: "estimate",
      blockLabel: "Numbers",
      estimateTarget: 1440,
      estimateTolerance: 50,
      options: []
    },
    {
      text: "Sort a simple CI chain.",
      type: "order",
      allowMultiple: true,
      blockLabel: "Flow",
      options: [
        { text: "Install dependencies", orderIndex: 0 },
        { text: "Run tests", orderIndex: 1 },
        { text: "Build artifacts", orderIndex: 2 },
        { text: "Deploy", orderIndex: 3 }
      ]
    },
    {
      text: "Single choice: which endpoint starts a game?",
      type: "choice",
      allowMultiple: false,
      blockLabel: "API",
      options: [
        { text: "POST /api/admin/:token/start", isCorrect: true, orderIndex: 0 },
        { text: "GET /api/state/:token", isCorrect: false, orderIndex: 1 },
        { text: "DELETE /api/admin/:token", isCorrect: false, orderIndex: 2 }
      ]
    }
  ];

  const out = [];
  for (let i = 0; i < count; i += 1) {
    const base = templates[i % templates.length];
    out.push({
      ...base,
      text: `${base.text} (#${i + 1})`
    });
  }
  return out;
}

async function runWithConcurrency(items, limit, worker) {
  const total = items.length;
  const workers = Math.max(1, Math.min(limit, total || 1));
  const result = new Array(total);
  let next = 0;

  const slots = Array.from({ length: workers }, async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= total) return;
      result[idx] = await worker(items[idx], idx);
    }
  });

  await Promise.all(slots);
  return result;
}

function makeRecorder() {
  const metrics = [];
  return {
    metrics,
    async timed(kind, op, fn) {
      const startedAt = performance.now();
      try {
        const value = await fn();
        const durationMs = performance.now() - startedAt;
        metrics.push({ kind, op, ok: true, durationMs, at: nowIso() });
        return value;
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        metrics.push({
          kind,
          op,
          ok: false,
          durationMs,
          at: nowIso(),
          error: String(error?.message || error || "unknown_error")
        });
        throw error;
      }
    }
  };
}

async function requestJson({
  recorder,
  apiBaseUrl,
  op,
  method = "GET",
  route,
  body = null,
  headers = {},
  expectedStatuses = [200]
}) {
  return recorder.timed("http", op, async () => {
    const targetUrl = joinUrl(apiBaseUrl, route);
    const reqHeaders = { ...headers };
    let payload = undefined;
    if (body !== null && body !== undefined) {
      reqHeaders["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(targetUrl, {
        method,
        headers: reqHeaders,
        body: payload
      });
    } catch (err) {
      const cause = err?.cause || {};
      const details = [
        cause?.code,
        cause?.address,
        cause?.port !== undefined ? `port=${cause.port}` : "",
        err?.message || ""
      ].filter(Boolean).join(" ");
      throw new Error(`request_failed ${method} ${targetUrl}${details ? ` (${details})` : ""}`);
    }

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }

    if (!expectedStatuses.includes(response.status)) {
      const detail = typeof data === "string" ? data : JSON.stringify(data || {});
      throw new Error(`${method} ${route} -> ${response.status}: ${detail}`);
    }

    return data;
  });
}

async function connectSocket({
  recorder,
  op,
  socketBaseUrl,
  socketPath,
  token,
  timeoutMs
}) {
  return recorder.timed("ws", op, async () => {
    const io = await getSocketIoFactory();
    return new Promise((resolve, reject) => {
      const socket = io(socketBaseUrl, {
        path: socketPath,
        transports: ["websocket", "polling"],
        reconnection: false,
        timeout: timeoutMs
      });

      let settled = false;
      let timeoutId = null;

      const cleanupListeners = () => {
        socket.off("connect", onConnect);
        socket.off("joined", onJoined);
        socket.off("connect_error", onConnectError);
        socket.off("error_msg", onErrorMsg);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        if (err) {
          try { socket.disconnect(); } catch {}
          reject(err);
          return;
        }
        resolve(value);
      };

      const onConnect = () => {
        try {
          socket.emit("join_game", { token });
        } catch (err) {
          finish(err);
        }
      };

      const onJoined = () => finish(null, socket);
      const onConnectError = (err) => {
        const detail = [
          err?.message,
          typeof err?.description === "string" ? err.description : "",
          err?.context?.status !== undefined ? `status=${err.context.status}` : ""
        ].filter(Boolean).join(" | ");
        finish(new Error(`socket_connect_error${detail ? `: ${detail}` : ""}`));
      };
      const onErrorMsg = (payload) => finish(new Error(payload?.error || "socket_error"));

      socket.on("connect", onConnect);
      socket.on("joined", onJoined);
      socket.on("connect_error", onConnectError);
      socket.on("error_msg", onErrorMsg);

      timeoutId = setTimeout(() => {
        finish(new Error("socket_join_timeout"));
      }, timeoutMs);
    });
  });
}

function disconnectSockets(sockets) {
  for (const socket of sockets) {
    if (!socket) continue;
    try {
      socket.disconnect();
    } catch {}
    activeSockets.delete(socket);
  }
}

function summarizeMetrics(metrics) {
  const groups = new Map();
  for (const m of metrics) {
    const key = `${m.kind}:${m.op}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  const rows = [];
  let total = 0;
  let success = 0;
  for (const [key, list] of groups.entries()) {
    const durations = list.map((x) => x.durationMs).sort((a, b) => a - b);
    const ok = list.filter((x) => x.ok).length;
    total += list.length;
    success += ok;
    rows.push({
      key,
      count: list.length,
      ok,
      fail: list.length - ok,
      successRate: list.length ? (ok / list.length) * 100 : 0,
      minMs: durations[0] || 0,
      avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
      maxMs: durations[durations.length - 1] || 0
    });
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  return {
    total,
    success,
    fail: total - success,
    successRate: total ? (success / total) * 100 : 0,
    byOp: rows
  };
}

function printSummary(summary, title) {
  console.log(`\n=== ${title} ===`);
  console.log(
    `total=${summary.total} ok=${summary.success} fail=${summary.fail} successRate=${round2(summary.successRate)}%`
  );
  console.log("operation,count,ok,fail,successRate,min,avg,p50,p95,p99,max");
  for (const row of summary.byOp) {
    console.log(
      [
        row.key,
        row.count,
        row.ok,
        row.fail,
        `${round2(row.successRate)}%`,
        round2(row.minMs),
        round2(row.avgMs),
        round2(row.p50Ms),
        round2(row.p95Ms),
        round2(row.p99Ms),
        round2(row.maxMs)
      ].join(",")
    );
  }
}

function toCsv(rows) {
  const esc = (value) => {
    const s = String(value ?? "");
    if (!/[",\n\r]/.test(s)) return s;
    return `"${s.replace(/"/g, "\"\"")}"`;
  };
  return `${rows.map((row) => row.map(esc).join(",")).join("\n")}\n`;
}

function getOp(summary, key) {
  return (summary?.byOp || []).find((row) => row.key === key) || null;
}

function buildRunsCsv(runs) {
  const rows = [
    [
      "run",
      "guests",
      "ok",
      "durationMs",
      "successRatePercent",
      "http:answer.guest_p95Ms",
      "ws:ws.connect.guest_p95Ms",
      "http:guest.join_p95Ms",
      "warnings"
    ]
  ];
  for (const run of runs || []) {
    rows.push([
      run.runIndex,
      run.guestCount,
      run.ok,
      round2(run.durationMs),
      round2(run?.summary?.successRate || 0),
      round2(getOp(run.summary, "http:answer.guest")?.p95Ms || 0),
      round2(getOp(run.summary, "ws:ws.connect.guest")?.p95Ms || 0),
      round2(getOp(run.summary, "http:guest.join")?.p95Ms || 0),
      (run.warnings || []).join(" | ")
    ]);
  }
  return toCsv(rows);
}

function buildCombinedCsv(summary) {
  const rows = [[
    "operation",
    "count",
    "ok",
    "fail",
    "successRatePercent",
    "minMs",
    "avgMs",
    "p50Ms",
    "p95Ms",
    "p99Ms",
    "maxMs"
  ]];
  for (const row of summary?.byOp || []) {
    rows.push([
      row.key,
      row.count,
      row.ok,
      row.fail,
      round2(row.successRate),
      round2(row.minMs),
      round2(row.avgMs),
      round2(row.p50Ms),
      round2(row.p95Ms),
      round2(row.p99Ms),
      round2(row.maxMs)
    ]);
  }
  return toCsv(rows);
}

function buildReportMarkdown(report, paths) {
  const lines = [];
  lines.push(`# Load Test Report`);
  lines.push("");
  lines.push(`- Created: ${report.createdAt}`);
  lines.push(`- Target URL: ${report.config.url}`);
  lines.push(`- Guest runs: ${report.config.guestCounts.join(", ")}`);
  lines.push(`- Questions: ${report.config.questionCount}`);
  lines.push("");
  lines.push(`## Combined`);
  lines.push("");
  lines.push(`- Total requests/events: ${report.combined.total}`);
  lines.push(`- Success rate: ${round2(report.combined.successRate)}%`);
  lines.push(`- Failures: ${report.combined.fail}`);
  lines.push("");
  lines.push(`## Per Run`);
  lines.push("");
  for (const run of report.runs || []) {
    lines.push(`### Run ${run.runIndex} (${run.guestCount} guests)`);
    lines.push(`- Status: ${run.ok ? "OK" : `FAILED (${run.error || "error"})`}`);
    lines.push(`- Duration: ${fmtMs(run.durationMs)}`);
    lines.push(`- Success rate: ${round2(run?.summary?.successRate || 0)}%`);
    lines.push(`- Guest answer p95: ${fmtMs(getOp(run.summary, "http:answer.guest")?.p95Ms || 0)}`);
    lines.push(`- Guest WS connect p95: ${fmtMs(getOp(run.summary, "ws:ws.connect.guest")?.p95Ms || 0)}`);
    if ((run.warnings || []).length) {
      lines.push(`- Warnings: ${(run.warnings || []).join(" | ")}`);
    }
    lines.push("");
  }
  lines.push(`## Artifacts`);
  lines.push("");
  lines.push(`- JSON: ${paths.jsonPath}`);
  lines.push(`- HTML: ${paths.htmlPath}`);
  lines.push(`- CSV runs: ${paths.runsCsvPath}`);
  lines.push(`- CSV combined: ${paths.combinedCsvPath}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildHtmlTableRows(rows) {
  return (rows || []).map((row) => `
    <tr>
      <td>${escapeHtml(row.key)}</td>
      <td>${row.count}</td>
      <td>${row.ok}</td>
      <td>${row.fail}</td>
      <td>${round2(row.successRate)}%</td>
      <td>${round2(row.p95Ms)}</td>
      <td>${round2(row.p99Ms)}</td>
      <td>${round2(row.maxMs)}</td>
    </tr>
  `).join("");
}

function buildRunRows(runs, maxDurationMs) {
  return (runs || []).map((run) => {
    const width = maxDurationMs > 0 ? Math.max(2, Math.round((Number(run.durationMs || 0) / maxDurationMs) * 100)) : 2;
    const answerP95 = getOp(run.summary, "http:answer.guest")?.p95Ms || 0;
    const wsP95 = getOp(run.summary, "ws:ws.connect.guest")?.p95Ms || 0;
    return `
      <tr>
        <td>Run ${run.runIndex}</td>
        <td>${run.guestCount}</td>
        <td><span class="badge ${run.ok ? "ok" : "fail"}">${run.ok ? "OK" : "FAIL"}</span></td>
        <td>
          ${round2(run.durationMs)} ms
          <div class="bar-wrap"><div class="bar" style="width:${width}%"></div></div>
        </td>
        <td>${round2(run.summary?.successRate || 0)}%</td>
        <td>${round2(answerP95)} ms</td>
        <td>${round2(wsP95)} ms</td>
      </tr>
    `;
  }).join("");
}

function buildReportHtml(report, paths) {
  const maxDurationMs = Math.max(0, ...(report.runs || []).map((r) => Number(r.durationMs || 0)));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Quizduell Load Test Report</title>
  <style>
    :root { --bg:#f8fafc; --card:#fff; --text:#0f172a; --muted:#475569; --ok:#065f46; --fail:#991b1b; --line:#e2e8f0; --accent:#0ea5e9; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:var(--bg); color:var(--text); }
    .container { max-width: 1200px; margin: 24px auto; padding: 0 16px 40px; display:grid; gap:16px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
    h1, h2 { margin:0 0 10px; }
    .meta { color:var(--muted); font-size:14px; line-height:1.6; }
    .grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .kpi { border:1px solid var(--line); border-radius:10px; padding:12px; background:#fff; }
    .kpi .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
    .kpi .value { font-size:26px; font-weight:700; margin-top:4px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { border-bottom:1px solid var(--line); padding:8px; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-weight:600; }
    .badge { display:inline-block; border-radius:999px; padding:2px 10px; font-size:12px; font-weight:700; }
    .badge.ok { background:#dcfce7; color:var(--ok); }
    .badge.fail { background:#fee2e2; color:var(--fail); }
    .bar-wrap { height:8px; border-radius:999px; background:#e2e8f0; margin-top:6px; overflow:hidden; }
    .bar { height:100%; border-radius:999px; background:linear-gradient(90deg, #38bdf8, #0284c7); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:13px; color:#334155; }
    .artifacts a { color:#0369a1; text-decoration:none; }
  </style>
</head>
<body>
  <div class="container">
    <section class="card">
      <h1>Quizduell Load Test Report</h1>
      <div class="meta">
        <div><strong>Created:</strong> ${escapeHtml(report.createdAt)}</div>
        <div><strong>Target:</strong> ${escapeHtml(report.config.url)}</div>
        <div><strong>Guest runs:</strong> ${escapeHtml((report.config.guestCounts || []).join(", "))}</div>
        <div><strong>Questions:</strong> ${escapeHtml(report.config.questionCount)}</div>
      </div>
    </section>

    <section class="card">
      <h2>Combined KPIs</h2>
      <div class="grid">
        <div class="kpi"><div class="label">Total Events</div><div class="value">${report.combined.total}</div></div>
        <div class="kpi"><div class="label">Success Rate</div><div class="value">${round2(report.combined.successRate)}%</div></div>
        <div class="kpi"><div class="label">Failures</div><div class="value">${report.combined.fail}</div></div>
        <div class="kpi"><div class="label">Runs</div><div class="value">${(report.runs || []).length}</div></div>
      </div>
    </section>

    <section class="card">
      <h2>Run Comparison</h2>
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Guests</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Success</th>
            <th>Guest Answer p95</th>
            <th>Guest WS Connect p95</th>
          </tr>
        </thead>
        <tbody>
          ${buildRunRows(report.runs || [], maxDurationMs)}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Combined Operations (p95/p99 focus)</h2>
      <table>
        <thead>
          <tr>
            <th>Operation</th>
            <th>Count</th>
            <th>OK</th>
            <th>Fail</th>
            <th>Success</th>
            <th>p95 (ms)</th>
            <th>p99 (ms)</th>
            <th>Max (ms)</th>
          </tr>
        </thead>
        <tbody>
          ${buildHtmlTableRows(report.combined.byOp || [])}
        </tbody>
      </table>
    </section>

    <section class="card artifacts">
      <h2>Artifacts</h2>
      <div class="mono">JSON: ${escapeHtml(paths.jsonPath)}</div>
      <div class="mono">Markdown: ${escapeHtml(paths.mdPath)}</div>
      <div class="mono">Runs CSV: ${escapeHtml(paths.runsCsvPath)}</div>
      <div class="mono">Combined CSV: ${escapeHtml(paths.combinedCsvPath)}</div>
    </section>
  </div>
</body>
</html>
`;
}

async function writeReportArtifacts(report, options) {
  const createdStamp = stampForFileName(report.createdAt);
  const reportDir = path.resolve(process.cwd(), options.reportDir);
  await fs.mkdir(reportDir, { recursive: true });

  const prefix = safeFilePart(options.reportPrefix, DEFAULTS.reportPrefix);
  const baseName = `${prefix}-${createdStamp}`;
  const defaultJsonPath = path.join(reportDir, `${baseName}.json`);
  const jsonPath = options.reportPath
    ? path.resolve(process.cwd(), options.reportPath)
    : defaultJsonPath;

  await fs.mkdir(path.dirname(jsonPath), { recursive: true });

  const parsed = path.parse(jsonPath);
  const baseNoExt = path.join(parsed.dir, parsed.name || baseName);
  const paths = {
    jsonPath,
    htmlPath: `${baseNoExt}.html`,
    mdPath: `${baseNoExt}.md`,
    runsCsvPath: `${baseNoExt}.runs.csv`,
    combinedCsvPath: `${baseNoExt}.combined.csv`
  };

  await fs.writeFile(paths.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(paths.runsCsvPath, buildRunsCsv(report.runs || []), "utf8");
  await fs.writeFile(paths.combinedCsvPath, buildCombinedCsv(report.combined || { byOp: [] }), "utf8");
  await fs.writeFile(paths.mdPath, buildReportMarkdown(report, paths), "utf8");
  await fs.writeFile(paths.htmlPath, buildReportHtml(report, paths), "utf8");

  return paths;
}

async function runOneScenario({
  runIndex,
  guestCount,
  questionCount,
  baseUrls,
  adminSecret,
  registerConcurrency,
  connectConcurrency,
  answerConcurrency,
  socketConnectTimeoutMs,
  wsConnectRetries,
  wsConnectRetryDelayMs,
  minConnectedRatio
}) {
  const recorder = makeRecorder();
  const warnings = [];
  const sockets = [];
  let keepAliveTimer = null;
  let gameId = null;
  let gameAdminToken = "";
  let adminSessionToken = "";

  const startedAtIso = nowIso();
  const startedAt = performance.now();

  try {
    logLine(`run ${runIndex}: admin login`);
    const loginData = await requestJson({
      recorder,
      apiBaseUrl: baseUrls.apiBaseUrl,
      op: "admin.login",
      method: "POST",
      route: "/admin/login",
      body: { secret: adminSecret }
    });
    adminSessionToken = String(loginData?.sessionToken || "");
    if (!adminSessionToken) throw new Error("admin_login_failed");

    const adminHeaders = { "x-admin-session": adminSessionToken };

    logLine(`run ${runIndex}: create fresh game`);
    const created = await requestJson({
      recorder,
      apiBaseUrl: baseUrls.apiBaseUrl,
      op: "game.create",
      method: "POST",
      route: "/games",
      headers: adminHeaders,
      body: {
        title: `Load Test Run ${runIndex} (${guestCount} guests)`,
        playerName: "Load Test Player"
      }
    });

    gameId = Number(created?.game?.id || 0);
    gameAdminToken = String(created?.tokens?.admin || "");
    const presentToken = String(created?.tokens?.present || "");
    const guestToken = String(created?.tokens?.guest_live || "");
    const playerToken = String(created?.tokens?.player || "");

    if (!gameId || !gameAdminToken || !presentToken || !guestToken || !playerToken) {
      throw new Error("missing_game_tokens");
    }

    const questionPayloads = createExampleQuestions(questionCount);
    logLine(`run ${runIndex}: create ${questionPayloads.length} questions`);
    for (let i = 0; i < questionPayloads.length; i += 1) {
      await requestJson({
        recorder,
        apiBaseUrl: baseUrls.apiBaseUrl,
        op: "question.create",
        method: "POST",
        route: `/admin/${gameAdminToken}/questions`,
        body: questionPayloads[i]
      });
    }

    logLine(`run ${runIndex}: register ${guestCount} guests`);
    const guestSeeds = Array.from({ length: guestCount }, (_, i) => ({
      index: i,
      nickname: `Guest_${runIndex}_${i + 1}`,
      clientKey: randomUUID()
    }));

    const guestParticipants = await runWithConcurrency(
      guestSeeds,
      registerConcurrency,
      async (seed) => {
        const joined = await requestJson({
          recorder,
          apiBaseUrl: baseUrls.apiBaseUrl,
          op: "guest.join",
          method: "POST",
          route: `/join/${guestToken}`,
          body: {
            nickname: seed.nickname,
            clientKey: seed.clientKey
          }
        });
        return {
          index: seed.index,
          participantId: Number(joined?.participantId || 0)
        };
      }
    );

    if (guestParticipants.some((g) => !g.participantId)) {
      throw new Error("guest_registration_incomplete");
    }

    logLine(`run ${runIndex}: connect presentation and player sockets`);
    const presentationSocket = await connectSocket({
      recorder,
      op: "ws.connect.presentation",
      socketBaseUrl: baseUrls.socketBaseUrl,
      socketPath: baseUrls.socketPath,
      token: presentToken,
      timeoutMs: socketConnectTimeoutMs
    });
    sockets.push(trackSocket(presentationSocket));

    const playerSocket = await connectSocket({
      recorder,
      op: "ws.connect.player",
      socketBaseUrl: baseUrls.socketBaseUrl,
      socketPath: baseUrls.socketPath,
      token: playerToken,
      timeoutMs: socketConnectTimeoutMs
    });
    sockets.push(trackSocket(playerSocket));

    logLine(`run ${runIndex}: connect ${guestCount} guest sockets`);
    const guestSocketResults = await runWithConcurrency(
      guestParticipants,
      connectConcurrency,
      async () => {
        let lastError = null;
        for (let attempt = 1; attempt <= wsConnectRetries; attempt += 1) {
          try {
            const socket = await connectSocket({
              recorder,
              op: "ws.connect.guest",
              socketBaseUrl: baseUrls.socketBaseUrl,
              socketPath: baseUrls.socketPath,
              token: guestToken,
              timeoutMs: socketConnectTimeoutMs
            });
            return { ok: true, socket, attempts: attempt };
          } catch (err) {
            lastError = err;
            if (attempt < wsConnectRetries) {
              await sleep(wsConnectRetryDelayMs * attempt);
            }
          }
        }
        return {
          ok: false,
          error: String(lastError?.message || lastError || "guest_ws_connect_failed"),
          attempts: wsConnectRetries
        };
      }
    );
    const guestSockets = guestSocketResults.filter((r) => r.ok).map((r) => r.socket);
    const guestSocketFailures = guestSocketResults.filter((r) => !r.ok);
    sockets.push(...guestSockets.map((socket) => trackSocket(socket)));

    if (guestSocketFailures.length > 0) {
      const sampleErrors = guestSocketFailures.slice(0, 3).map((r) => r.error).join(" | ");
      warnings.push(
        `guest websocket connect failures=${guestSocketFailures.length}/${guestCount}`
        + `${sampleErrors ? `; sample=${sampleErrors}` : ""}`
      );
    }

    const requiredConnected = Math.ceil(guestCount * minConnectedRatio);
    if (guestSockets.length < requiredConnected) {
      throw new Error(
        `guest_socket_connect_threshold_not_met connected=${guestSockets.length}/${guestCount}`
        + ` required=${requiredConnected} retries=${wsConnectRetries}`
      );
    }

    keepAliveTimer = trackInterval(setInterval(() => {
      for (const socket of sockets) {
        try {
          if (socket?.connected) socket.emit("keep_alive");
        } catch {}
      }
    }, 15_000));

    logLine(`run ${runIndex}: join player`);
    const playerJoin = await requestJson({
      recorder,
      apiBaseUrl: baseUrls.apiBaseUrl,
      op: "player.join",
      method: "POST",
      route: `/join/${playerToken}`,
      body: {}
    });
    const playerId = Number(playerJoin?.participantId || 0);
    if (!playerId) throw new Error("player_join_failed");

    logLine(`run ${runIndex}: start game`);
    await requestJson({
      recorder,
      apiBaseUrl: baseUrls.apiBaseUrl,
      op: "game.start",
      method: "POST",
      route: `/admin/${gameAdminToken}/start`,
      body: {}
    });

    let playedQuestions = 0;
    const maxLoops = questionPayloads.length + 5;

    while (playedQuestions < maxLoops) {
      const state = await requestJson({
        recorder,
        apiBaseUrl: baseUrls.apiBaseUrl,
        op: "state.poll",
        method: "GET",
        route: `/state/${gameAdminToken}`
      });

      if (state?.game?.status === "finished") break;
      if (state?.game?.status !== "live") throw new Error(`unexpected_game_status:${state?.game?.status}`);

      const idx = Number(state?.game?.currentQuestionIndex || 0);
      const question = state?.questions?.[idx];
      if (!question) throw new Error("missing_current_question");

      await requestJson({
        recorder,
        apiBaseUrl: baseUrls.apiBaseUrl,
        op: "answer.player",
        method: "POST",
        route: `/answer/${playerToken}`,
        body: {
          participantId: playerId,
          questionId: question.id,
          ...buildRandomAnswer(question)
        }
      });

      const guestAnswerResult = await runWithConcurrency(
        guestParticipants,
        answerConcurrency,
        async (guest) => {
          try {
            await requestJson({
              recorder,
              apiBaseUrl: baseUrls.apiBaseUrl,
              op: "answer.guest",
              method: "POST",
              route: `/answer/${guestToken}`,
              body: {
                participantId: guest.participantId,
                questionId: question.id,
                ...buildRandomAnswer(question)
              }
            });
            return true;
          } catch {
            return false;
          }
        }
      );

      const failedAnswers = guestAnswerResult.filter((ok) => !ok).length;
      if (failedAnswers > 0) {
        warnings.push(`question ${idx + 1}: ${failedAnswers} guest answers failed`);
      }

      await requestJson({
        recorder,
        apiBaseUrl: baseUrls.apiBaseUrl,
        op: "present.reveal",
        method: "POST",
        route: `/present/${presentToken}/reveal`,
        body: {}
      });

      await requestJson({
        recorder,
        apiBaseUrl: baseUrls.apiBaseUrl,
        op: "present.next",
        method: "POST",
        route: `/present/${presentToken}/next`,
        body: {}
      });

      playedQuestions += 1;
      logLine(`run ${runIndex}: finished question ${playedQuestions}/${questionPayloads.length}`);
    }

    const finalState = await requestJson({
      recorder,
      apiBaseUrl: baseUrls.apiBaseUrl,
      op: "state.final",
      method: "GET",
      route: `/state/${gameAdminToken}`
    });

    if (finalState?.game?.status !== "finished") {
      warnings.push(`game did not reach finished status (status=${finalState?.game?.status || "unknown"})`);
    }

    await requestJson({
      recorder,
      apiBaseUrl: baseUrls.apiBaseUrl,
      op: "present.share",
      method: "GET",
      route: `/present/${presentToken}/share`
    });

    const durationMs = performance.now() - startedAt;
    return {
      ok: true,
      runIndex,
      guestCount,
      gameId,
      startedAt: startedAtIso,
      endedAt: nowIso(),
      durationMs: round2(durationMs),
      warnings,
      metrics: recorder.metrics,
      summary: summarizeMetrics(recorder.metrics),
      scenario: {
        requestedGuests: guestCount,
        registeredGuests: guestParticipants.length,
        connectedGuestSockets: guestSockets.length,
        playedQuestions
      }
    };
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    return {
      ok: false,
      runIndex,
      guestCount,
      gameId,
      startedAt: startedAtIso,
      endedAt: nowIso(),
      durationMs: round2(durationMs),
      warnings,
      error: String(error?.message || error || "unknown_error"),
      metrics: recorder.metrics,
      summary: summarizeMetrics(recorder.metrics),
      scenario: null
    };
  } finally {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      untrackInterval(keepAliveTimer);
    }
    disconnectSockets(sockets);

    if (gameAdminToken) {
      try {
        await requestJson({
          recorder,
          apiBaseUrl: baseUrls.apiBaseUrl,
          op: "game.delete",
          method: "DELETE",
          route: `/admin/${gameAdminToken}`,
          body: null,
          expectedStatuses: [200, 404]
        });
        logLine(`run ${runIndex}: deleted game via token ${gameAdminToken}`);
      } catch (cleanupErr) {
        logLine(`run ${runIndex}: cleanup delete failed: ${cleanupErr?.message || cleanupErr}`);
      }
    }

    if (adminSessionToken) {
      try {
        await requestJson({
          recorder,
          apiBaseUrl: baseUrls.apiBaseUrl,
          op: "admin.logout",
          method: "POST",
          route: "/admin/logout",
          headers: { "x-admin-session": adminSessionToken },
          body: {}
        });
      } catch {}
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const rawUrl = String(args.url || "").trim();
  const adminToken = String(args["admin-token"] || "").trim();
  if (!rawUrl || !adminToken) {
    printUsage();
    throw new Error("missing_required_arguments");
  }

  const guestCounts = parseGuestCounts(args.guests, args["guest-counts"]);
  const questionCount = asPositiveInt(args.questions, DEFAULTS.questions);
  const registerConcurrency = asPositiveInt(args["register-concurrency"], DEFAULTS.registerConcurrency);
  const connectConcurrency = asPositiveInt(args["connect-concurrency"], DEFAULTS.connectConcurrency);
  const answerConcurrency = asPositiveInt(args["answer-concurrency"], DEFAULTS.answerConcurrency);
  const socketConnectTimeoutMs = asPositiveInt(args["socket-timeout-ms"], DEFAULTS.socketConnectTimeoutMs);
  const wsConnectRetries = asPositiveInt(args["ws-connect-retries"], DEFAULTS.wsConnectRetries);
  const wsConnectRetryDelayMs = asPositiveInt(args["ws-retry-delay-ms"], DEFAULTS.wsConnectRetryDelayMs);
  const minConnectedRatio = asRatio(args["min-connected-ratio"], DEFAULTS.minConnectedRatio);
  const reportPath = String(args.report || "").trim();
  const reportDir = String(args["report-dir"] || DEFAULTS.reportDir).trim();
  const reportPrefix = String(args["report-prefix"] || DEFAULTS.reportPrefix).trim();

  const inDocker = await isRunningInDocker();
  let effectiveUrl = rawUrl;
  if (inDocker) {
    const rewritten = rewriteLoopbackUrlForDocker(rawUrl);
    if (rewritten.rewritten) {
      effectiveUrl = rewritten.url;
      logLine(`detected Docker + loopback URL, rewritten to ${effectiveUrl}`);
    }
  }

  const baseUrls = normalizeBaseUrls(effectiveUrl);

  logLine(`apiBaseUrl=${baseUrls.apiBaseUrl}`);
  logLine(`socketBaseUrl=${baseUrls.socketBaseUrl}`);
  logLine(`socketPath=${baseUrls.socketPath}`);
  logLine(`runs=${guestCounts.join(",")} guests; questions=${questionCount}`);

  const runs = [];
  for (let i = 0; i < guestCounts.length; i += 1) {
    const guestCount = guestCounts[i];
    logLine(`starting run ${i + 1}/${guestCounts.length} with ${guestCount} guests`);
    const run = await runOneScenario({
      runIndex: i + 1,
      guestCount,
      questionCount,
      baseUrls,
      adminSecret: adminToken,
      registerConcurrency,
      connectConcurrency,
      answerConcurrency,
      socketConnectTimeoutMs,
      wsConnectRetries,
      wsConnectRetryDelayMs,
      minConnectedRatio
    });
    runs.push(run);
    printSummary(run.summary, `Run ${run.runIndex} (${guestCount} guests)`);
    if (!run.ok) {
      logLine(`run ${run.runIndex} failed: ${run.error}`);
    } else {
      logLine(`run ${run.runIndex} complete in ${run.durationMs}ms`);
    }
  }

  const allMetrics = runs.flatMap((r) => r.metrics || []);
  const combined = summarizeMetrics(allMetrics);
  printSummary(combined, "Combined");

  const report = {
    createdAt: nowIso(),
    config: {
      url: effectiveUrl,
      apiBaseUrl: baseUrls.apiBaseUrl,
      socketBaseUrl: baseUrls.socketBaseUrl,
      socketPath: baseUrls.socketPath,
      guestCounts,
      questionCount,
      registerConcurrency,
      connectConcurrency,
      answerConcurrency,
      socketConnectTimeoutMs,
      wsConnectRetries,
      wsConnectRetryDelayMs,
      minConnectedRatio
    },
    runs,
    combined
  };

  const artifactPaths = await writeReportArtifacts(report, {
    reportPath: reportPath || null,
    reportDir,
    reportPrefix
  });
  logLine(`report json: ${artifactPaths.jsonPath}`);
  logLine(`report html: ${artifactPaths.htmlPath}`);
  logLine(`report md: ${artifactPaths.mdPath}`);
  logLine(`report csv runs: ${artifactPaths.runsCsvPath}`);
  logLine(`report csv combined: ${artifactPaths.combinedCsvPath}`);

  const failedRuns = runs.filter((r) => !r.ok).length;
  exitNow(failedRuns > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  exitNow(1);
});

process.on("SIGINT", () => {
  logLine("SIGINT received, shutting down now.");
  exitNow(130);
});

process.on("SIGTERM", () => {
  logLine("SIGTERM received, shutting down now.");
  exitNow(143);
});
