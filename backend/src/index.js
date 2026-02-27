import express from "express";
import cors from "cors";
import http from "http";
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import QRCode from "qrcode";
import { Server } from "socket.io";
import { Op, QueryTypes } from "sequelize";
import { nanoid } from "nanoid";
import multer from "multer";

import { makeSequelize } from "./db.js";
import { defineModels } from "./models.js";
import {
  createGame,
  getGameByToken,
  loadGameFull,
  computeScore,
  computeGuestVoteCounts,
  publicLinks
} from "./gameService.js";
import {
  getAvailableLanguages,
  normalizeUiLanguage,
  preloadTranslations,
  translate,
  translationFilePathFromPair
} from "./i18n.js";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:8080";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "16mb";
const SOLUTION_IMAGE_MAX_EDGE = Number(process.env.SOLUTION_IMAGE_MAX_EDGE || 1920);
const SOLUTION_IMAGE_QUALITY = Number(process.env.SOLUTION_IMAGE_QUALITY || 82);
const APP_SECRET = String(process.env.APP_SECRET || "dev-secret-change-me");
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "");
const ADMIN_SESSION_TTL_HOURS = Math.max(1, Number(process.env.ADMIN_SESSION_TTL_HOURS || 12));
const LOGIN_RATE_LIMIT_WINDOW_MS = Math.max(60_000, Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 10 * 60_000));
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Math.max(3, Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 10));
const MEDIA_ROOT = path.resolve(String(process.env.MEDIA_ROOT || path.join(process.cwd(), "media")));
const MEDIA_TMP_ROOT = path.join(MEDIA_ROOT, ".tmp");
const QUESTION_PACKAGES_ROOT = path.resolve(String(process.env.QUESTION_PACKAGES_ROOT || path.join(process.cwd(), "question-packages")));
const MEDIA_UPLOAD_MAX_BYTES = Number(process.env.MEDIA_UPLOAD_MAX_BYTES || 0);
const FFMPEG_VIDEO_CRF = Math.max(18, Math.min(36, Number(process.env.FFMPEG_VIDEO_CRF || 28)));
const FFMPEG_VIDEO_MAX_WIDTH = Math.max(320, Number(process.env.FFMPEG_VIDEO_MAX_WIDTH || 1280));
const FFMPEG_VIDEO_MAX_HEIGHT = Math.max(240, Number(process.env.FFMPEG_VIDEO_MAX_HEIGHT || 720));
const FFMPEG_AUDIO_BITRATE_K = Math.max(64, Number(process.env.FFMPEG_AUDIO_BITRATE_K || 128));
const UPLOAD_REQUEST_TIMEOUT_MS = Number(process.env.UPLOAD_REQUEST_TIMEOUT_MS || 0);
const AUTO_REVEAL_DELAY_MS = Math.max(500, Number(process.env.AUTO_REVEAL_DELAY_MS || 1700));
const DEFAULT_AUTO_REVEAL_DELAY_SECONDS = Math.max(1, Math.round(AUTO_REVEAL_DELAY_MS / 1000));
const MIN_AUTO_REVEAL_DELAY_SECONDS = 1;
const MAX_AUTO_REVEAL_DELAY_SECONDS = 60;
const GAME_STATE_THROTTLE_MS = Math.max(0, Number(process.env.GAME_STATE_THROTTLE_MS || 120));
const LIVE_SCORE_RANKING_LIMIT = Math.max(0, Number(process.env.LIVE_SCORE_RANKING_LIMIT || 100));
const SOCKET_JOIN_SEND_STATE = String(process.env.SOCKET_JOIN_SEND_STATE || "false").trim().toLowerCase() === "true";
const QUESTION_PACKAGE_VERSION = 1;
const FULL_GAME_EXPORT_VERSION = 1;

process.on("unhandledRejection", (reason) => {
  logCompactError("unhandled rejection", reason);
});

const sequelize = makeSequelize();
const models = defineModels(sequelize);

function quotedSqlIdent(name) {
  return `\`${String(name || "").replace(/`/g, "``")}\``;
}

async function cleanupDuplicateUniqueIndexes({ tableName, columnName, targetIndexName }) {
  try {
    const safeTable = String(tableName || "");
    const safeColumn = String(columnName || "");
    const safeTargetIndex = String(targetIndexName || "");
    if (!safeTable || !safeColumn || !safeTargetIndex) return;

    const tableRows = await sequelize.query(
      `
      SELECT COUNT(*) AS tableCount
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { tableName: safeTable }
      }
    );
    const tableCount = Number(tableRows?.[0]?.tableCount || 0);
    if (!tableCount) return;

    const indexRows = await sequelize.query(
      `
      SELECT DISTINCT INDEX_NAME AS indexName
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
        AND COLUMN_NAME = :columnName
        AND NON_UNIQUE = 0
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          tableName: safeTable,
          columnName: safeColumn
        }
      }
    );

    const keyNames = [...new Set((indexRows || []).map(r => String(r.indexName || "").trim()).filter(Boolean))];
    for (const keyName of keyNames) {
      if (keyName === "PRIMARY") continue;
      await sequelize.query(`ALTER TABLE ${quotedSqlIdent(safeTable)} DROP INDEX ${quotedSqlIdent(keyName)};`);
    }

    await sequelize.query(
      `ALTER TABLE ${quotedSqlIdent(safeTable)} ADD UNIQUE INDEX ${quotedSqlIdent(safeTargetIndex)} (${quotedSqlIdent(safeColumn)});`
    );
  } catch (err) {
    console.warn(`cleanupDuplicateUniqueIndexes skipped for ${tableName}.${columnName}:`, err?.message || err);
  }
}

await sequelize.authenticate();
await cleanupDuplicateUniqueIndexes({
  tableName: "Links",
  columnName: "token",
  targetIndexName: "uniq_links_token"
});
await cleanupDuplicateUniqueIndexes({
  tableName: "AdminSessions",
  columnName: "tokenHash",
  targetIndexName: "uniq_admin_sessions_token_hash"
});
// Für dieses Projekt ist "alter" praktisch, damit neue Spalten (z.B. isPublished) automatisch entstehen.
await sequelize.sync({ alter: true });
await fsp.mkdir(MEDIA_ROOT, { recursive: true });
await fsp.mkdir(MEDIA_TMP_ROOT, { recursive: true });
await fsp.mkdir(QUESTION_PACKAGES_ROOT, { recursive: true });
await seedBuiltinMediaAssets();
await preloadTranslations();

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use("/media", express.static(MEDIA_ROOT, {
  index: false,
  etag: true,
  maxAge: "7d"
}));

const server = http.createServer(app);
if (Number.isFinite(UPLOAD_REQUEST_TIMEOUT_MS) && UPLOAD_REQUEST_TIMEOUT_MS >= 0) {
  // 0 disables request timeout: useful for very large uploads on slow links.
  server.requestTimeout = UPLOAD_REQUEST_TIMEOUT_MS;
}
const io = new Server(server, { cors: { origin: "*" } });
const QUESTION_TYPES = new Set(["choice", "estimate", "order", "media_identity", "image_identity", "audio_identity", "video_identity", "risk"]);
const CHOICE_LIKE_TYPES = new Set(["choice", "image_identity", "audio_identity", "video_identity", "risk"]);
const loginAttemptsByIp = new Map();
const uploadLimits = {};
if (Number.isFinite(MEDIA_UPLOAD_MAX_BYTES) && MEDIA_UPLOAD_MAX_BYTES > 0) {
  uploadLimits.fileSize = MEDIA_UPLOAD_MAX_BYTES;
}
const uploadMedia = multer({
  dest: MEDIA_TMP_ROOT,
  limits: uploadLimits
});
const autoRevealTimers = new Map();
const gameStateEmitTimers = new Map();
const BUILTIN_BIRTHDAY_MEDIA = Object.freeze({
  cakeImage: "/media/builtin/geburtstag/torte_30.svg",
  drinkImage: "/media/builtin/geburtstag/getraenk_kaffee.svg",
  signalAudio: "/media/builtin/geburtstag/signalton.mp3",
  applauseAudio: "/media/builtin/geburtstag/applaus.mp3",
  birthdayVideo: "/media/builtin/geburtstag/happy_birthday.mp4",
  confettiVideo: "/media/builtin/geburtstag/konfetti.mp4"
});

function normalizeAutoRevealDelaySeconds(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_REVEAL_DELAY_SECONDS;
  const rounded = Math.round(parsed);
  return Math.max(MIN_AUTO_REVEAL_DELAY_SECONDS, Math.min(MAX_AUTO_REVEAL_DELAY_SECONDS, rounded));
}

function normalizeGuestThresholdPercent(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return 50;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeGuestCorrectRule(raw) {
  const value = String(raw || "").trim().toLowerCase();
  return value === "plurality" ? "plurality" : "threshold";
}

function normalizeGameTitle(raw, fallback = "Quiz") {
  const title = String(raw || "").trim().slice(0, 200);
  return title || fallback;
}

function autoRevealDelayMsForGame(game) {
  return normalizeAutoRevealDelaySeconds(game?.autoRevealDelaySeconds) * 1000;
}

const BUILTIN_QUESTION_PACKAGES = [
  {
    id: "builtin:geburtstag",
    name: "Geburtstag",
    description: "Party-Set mit Choice, Risiko, Reihenfolge, Schätzung und lokalen Medien-Demos (Bild/Audio/Video).",
    kind: "builtin",
    questions: [
      {
        text: "Welches Lieblingsgetraenk passt zur Geburtstagsrunde?",
        type: "choice",
        allowMultiple: false,
        blockLabel: "Getraenke",
        solutionText: "Im Loesungsbild steht das Lieblingsgetraenk auf Kaffee.",
        solutionImage: BUILTIN_BIRTHDAY_MEDIA.drinkImage,
        options: [
          { text: "Kaffee", isCorrect: true, orderIndex: 0 },
          { text: "Tee", isCorrect: false, orderIndex: 1 },
          { text: "Cola", isCorrect: false, orderIndex: 2 },
          { text: "Wasser mit Zitrone", isCorrect: false, orderIndex: 3 }
        ]
      },
      {
        text: "Wie viele Kerzen stehen auf der Geburtstagstorte?",
        type: "estimate",
        blockLabel: "Geburtstage",
        estimateTarget: 30,
        estimateTolerance: 2,
        solutionText: "Das Loesungsbild zeigt eine Torte mit 30 Kerzen.",
        solutionImage: BUILTIN_BIRTHDAY_MEDIA.cakeImage,
        options: []
      },
      {
        text: "Risk: Wann passt der Applaus-Sound am besten?",
        type: "risk",
        allowMultiple: false,
        blockLabel: "Fun Facts",
        solutionText: "Der Applaus markiert den Moment nach dem Kerzen-Ausblasen.",
        solutionAudio: BUILTIN_BIRTHDAY_MEDIA.applauseAudio,
        options: [
          { text: "Nach dem Kerzen-Ausblasen", isCorrect: true, orderIndex: 0 },
          { text: "Beim Tischdecken", isCorrect: false, orderIndex: 1 },
          { text: "Beim Schuhe ausziehen", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Sortiere den typischen Ablauf der Feier.",
        type: "order",
        blockLabel: "Ablauf",
        solutionText: "Der Video-Loop zeigt den zentralen Geburtstagsmoment als Aufloesung.",
        solutionVideo: BUILTIN_BIRTHDAY_MEDIA.birthdayVideo,
        options: [
          { text: "Gaeste kommen an", orderIndex: 0 },
          { text: "Kerzen ausblasen", orderIndex: 1 },
          { text: "Torte anschneiden", orderIndex: 2 },
          { text: "Spiele & Musik", orderIndex: 3 }
        ]
      },
      {
        text: "Bildfrage: Was ist auf dem Bild zu sehen?",
        type: "image_identity",
        allowMultiple: false,
        blockLabel: "Medien-Demo",
        promptImage: BUILTIN_BIRTHDAY_MEDIA.cakeImage,
        solutionText: "Das Bild zeigt die Geburtstagstorte mit 30 Kerzen.",
        solutionAudio: BUILTIN_BIRTHDAY_MEDIA.applauseAudio,
        options: [
          { text: "Eine Geburtstagstorte mit 30 Kerzen", isCorrect: true, orderIndex: 0 },
          { text: "Eine Kaffeetasse", isCorrect: false, orderIndex: 1 },
          { text: "Ein Geschenkkarton", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Audiofrage: Welches Geraeusch hoerst du?",
        type: "audio_identity",
        allowMultiple: false,
        blockLabel: "Medien-Demo",
        promptAudio: BUILTIN_BIRTHDAY_MEDIA.signalAudio,
        solutionText: "Zu hoeren ist ein kurzer hoher Signalton.",
        solutionVideo: BUILTIN_BIRTHDAY_MEDIA.birthdayVideo,
        options: [
          { text: "Ein kurzer Signalton", isCorrect: true, orderIndex: 0 },
          { text: "Applaus", isCorrect: false, orderIndex: 1 },
          { text: "Ein langer Trommelwirbel", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Videofrage: Was zeigt der Clip?",
        type: "video_identity",
        allowMultiple: false,
        blockLabel: "Medien-Demo",
        promptVideo: BUILTIN_BIRTHDAY_MEDIA.confettiVideo,
        solutionText: "Der Clip zeigt einen Konfetti-Demo-Loop mit Testbild-Hintergrund.",
        solutionImage: BUILTIN_BIRTHDAY_MEDIA.cakeImage,
        options: [
          { text: "Einen Konfetti-Demo-Loop", isCorrect: true, orderIndex: 0 },
          { text: "Eine Person beim Kerzen-Ausblasen", isCorrect: false, orderIndex: 1 },
          { text: "Eine Dia-Show mit Fotos", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Welche Deko passt am besten zu einer lockeren Geburtstagsparty?",
        type: "choice",
        allowMultiple: false,
        blockLabel: "Motto",
        solutionText: "Bunte Ballons und Lichterkette passen zum gezeigten Party-Stil.",
        solutionVideo: BUILTIN_BIRTHDAY_MEDIA.confettiVideo,
        options: [
          { text: "Bunte Ballons und Lichterkette", isCorrect: true, orderIndex: 0 },
          { text: "Nur schwarze Tischdecken", isCorrect: false, orderIndex: 1 },
          { text: "Keine Dekoration", isCorrect: false, orderIndex: 2 }
        ]
      }
    ]
  },
  {
    id: "builtin:hochzeit",
    name: "Hochzeit",
    description: "Romantisches Paket fuer Brautpaar-Story, Timeline und Insider-Wissen.",
    kind: "builtin",
    questions: [
      {
        text: "Wer hat beim ersten Date den Ort vorgeschlagen?",
        type: "choice",
        allowMultiple: false,
        blockLabel: "Kennenlernen",
        options: [
          { text: "Braut", isCorrect: true, orderIndex: 0 },
          { text: "Braeutigam", isCorrect: false, orderIndex: 1 },
          { text: "Freunde", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Wie viele Jahre sind die beiden heute zusammen?",
        type: "estimate",
        blockLabel: "Timeline",
        estimateTarget: 7,
        estimateTolerance: 1,
        options: []
      },
      {
        text: "Welcher Song lief beim Antrag?",
        type: "choice",
        allowMultiple: false,
        blockLabel: "Momente",
        options: [
          { text: "Perfect", isCorrect: true, orderIndex: 0 },
          { text: "Thinking Out Loud", isCorrect: false, orderIndex: 1 },
          { text: "A Thousand Years", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Sortiere den Hochzeitstag chronologisch.",
        type: "order",
        blockLabel: "Hochzeitstag",
        options: [
          { text: "Trauung", orderIndex: 0 },
          { text: "Sektempfang", orderIndex: 1 },
          { text: "Abendessen", orderIndex: 2 },
          { text: "Party", orderIndex: 3 }
        ]
      }
    ]
  },
  {
    id: "builtin:team-event",
    name: "Team-Event",
    description: "Lockeres Company-Set fuer Onboarding, Teamwissen und Office-Humor.",
    kind: "builtin",
    questions: [
      {
        text: "Welches Tool nutzt das Team am haeufigsten?",
        type: "choice",
        allowMultiple: false,
        blockLabel: "Arbeitsalltag",
        options: [
          { text: "Slack", isCorrect: true, orderIndex: 0 },
          { text: "E-Mail", isCorrect: false, orderIndex: 1 },
          { text: "Telefon", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Wie viele Kaffees trinken wir pro Woche im Schnitt?",
        type: "estimate",
        blockLabel: "Office",
        estimateTarget: 120,
        estimateTolerance: 20,
        options: []
      },
      {
        text: "Risko: Welcher Satz faellt im Standup am haeufigsten?",
        type: "risk",
        allowMultiple: false,
        blockLabel: "Standup",
        options: [
          { text: "Ich bin blockiert", isCorrect: true, orderIndex: 0 },
          { text: "Keine Updates", isCorrect: false, orderIndex: 1 },
          { text: "Alles fertig", isCorrect: false, orderIndex: 2 }
        ]
      },
      {
        text: "Sortiere einen typischen Release-Tag.",
        type: "order",
        blockLabel: "Release",
        options: [
          { text: "Review", orderIndex: 0 },
          { text: "Merge", orderIndex: 1 },
          { text: "Deploy", orderIndex: 2 },
          { text: "Monitoring", orderIndex: 3 }
        ]
      }
    ]
  }
];
const BUILTIN_PACKAGE_BY_ID = new Map(BUILTIN_QUESTION_PACKAGES.map(p => [p.id, p]));

function gameRoom(gameId) {
  return `game:${gameId}`;
}

function publicBaseUrlFor(req) {
  if (!req) return PUBLIC_BASE_URL;

  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";

  const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  const host = forwardedHost || req.get("host") || "";

  if (!host) return PUBLIC_BASE_URL;
  return `${proto}://${host}`;
}

let sharpLibPromise = null;
async function getSharpLib() {
  if (!sharpLibPromise) {
    sharpLibPromise = import("sharp")
      .then(m => m.default || m)
      .catch(() => null);
  }
  return sharpLibPromise;
}

let ffmpegAvailablePromise = null;
async function hasFfmpeg() {
  if (!ffmpegAvailablePromise) {
    ffmpegAvailablePromise = new Promise((resolve) => {
      const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  }
  return ffmpegAvailablePromise;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      return reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });
}

async function seedBuiltinMediaAssets() {
  const bundledMediaRoot = path.resolve(process.cwd(), "src", "builtin-media");
  try {
    await fsp.access(bundledMediaRoot);
  } catch {
    return;
  }
  try {
    const targetRoot = path.join(MEDIA_ROOT, "builtin");
    await fsp.mkdir(targetRoot, { recursive: true });
    await fsp.cp(bundledMediaRoot, targetRoot, {
      recursive: true,
      force: false,
      errorOnExist: false
    });
  } catch (err) {
    logCompactError("seed builtin media failed", err);
  }
}

function mediaKindConfig(rawKind) {
  const kind = String(rawKind || "").trim().toLowerCase();
  const map = {
    prompt_image: { group: "prompt", medium: "image" },
    prompt_audio: { group: "prompt", medium: "audio" },
    prompt_video: { group: "prompt", medium: "video" },
    prompt_media: { group: "prompt", medium: "any" },
    solution_image: { group: "solution", medium: "image" },
    solution_audio: { group: "solution", medium: "audio" },
    solution_video: { group: "solution", medium: "video" },
    solution_media: { group: "solution", medium: "any" },
    finish_image: { group: "finish", medium: "image" },
    finish_audio: { group: "finish", medium: "audio" },
    finish_video: { group: "finish", medium: "video" },
    finish_media: { group: "finish", medium: "any" },
    option_image: { group: "option", medium: "image" }
  };
  return map[kind] ? { kind, ...map[kind] } : null;
}

function mimeMatchesMedium(mime, medium) {
  const m = String(mime || "").toLowerCase();
  if (!m) return false;
  if (medium === "image") return m.startsWith("image/");
  if (medium === "audio") return m.startsWith("audio/");
  if (medium === "video") return m.startsWith("video/");
  return false;
}

function filenameLooksLikeMedium(filename, medium) {
  const ext = String(path.extname(String(filename || "")).toLowerCase());
  if (!ext) return false;
  const imageExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".svg"]);
  const audioExt = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".flac", ".opus"]);
  const videoExt = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mpeg", ".mpg", ".ogv"]);
  if (medium === "image") return imageExt.has(ext);
  if (medium === "audio") return audioExt.has(ext);
  if (medium === "video") return videoExt.has(ext);
  return false;
}

function detectMediumFromFilename(filename) {
  if (filenameLooksLikeMedium(filename, "image")) return "image";
  if (filenameLooksLikeMedium(filename, "audio")) return "audio";
  if (filenameLooksLikeMedium(filename, "video")) return "video";
  return "";
}

function detectMediumFromUpload(file) {
  const mime = String(file?.mimetype || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return detectMediumFromFilename(file?.originalname || "");
}

function inferMediumFromMediaRef(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  if (/^data:image\//i.test(value)) return "image";
  if (/^data:audio\//i.test(value)) return "audio";
  if (/^data:video\//i.test(value)) return "video";

  if (value.startsWith("/media/")) {
    const pathname = value.split("?")[0].split("#")[0];
    return detectMediumFromFilename(pathname);
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      return detectMediumFromFilename(u.pathname || "");
    } catch {
      return "";
    }
  }

  return "";
}

function safeExtensionFromFilename(name = "", fallback = ".bin") {
  const ext = String(path.extname(String(name || "")).toLowerCase() || "");
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  return fallback;
}

function fallbackExtensionForMime(mime, medium) {
  const m = String(mime || "").toLowerCase();
  if (medium === "image") {
    if (m.includes("png")) return ".png";
    if (m.includes("webp")) return ".webp";
    if (m.includes("avif")) return ".avif";
    if (m.includes("gif")) return ".gif";
    if (m.includes("bmp")) return ".bmp";
    return ".jpg";
  }
  if (medium === "audio") {
    if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
    if (m.includes("ogg")) return ".ogg";
    if (m.includes("wav")) return ".wav";
    if (m.includes("flac")) return ".flac";
    if (m.includes("aac")) return ".aac";
    return ".m4a";
  }
  if (medium === "video") {
    if (m.includes("webm")) return ".webm";
    if (m.includes("quicktime")) return ".mov";
    if (m.includes("x-matroska") || m.includes("mkv")) return ".mkv";
    if (m.includes("avi")) return ".avi";
    return ".mp4";
  }
  return ".bin";
}

function logCompactError(scope, err) {
  const name = String(err?.name || "Error");
  const code = String(err?.original?.code || err?.code || "").trim();
  const rawMessage = String(err?.message || err || "unknown_error");
  const message = rawMessage.replace(/\s+/g, " ").slice(0, 600);
  const codePart = code ? ` [${code}]` : "";
  console.error(`${scope}: ${name}${codePart} ${message}`);
}

function safeRelMediaPath(...parts) {
  return parts.map(p => String(p || "").replace(/[^a-zA-Z0-9._-]/g, "_")).join("/");
}

async function removeFileQuiet(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch {}
}

async function listFilesRecursive(rootDir) {
  const out = [];
  let entries = [];
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listFilesRecursive(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

async function removeEmptyDirsRecursive(rootDir) {
  let entries = [];
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(rootDir, entry.name);
    await removeEmptyDirsRecursive(abs);
  }
  try {
    const rest = await fsp.readdir(rootDir);
    if (rest.length === 0) await fsp.rmdir(rootDir);
  } catch {}
}

function questionMediaRefs(q) {
  const refs = [
    q?.promptImage,
    q?.promptAudio,
    q?.promptVideo,
    q?.solutionImage,
    q?.solutionAudio,
    q?.solutionVideo,
    ...(Array.isArray(q?.Options) ? q.Options.map(o => o?.image) : [])
  ].map(x => String(x || "").trim()).filter(Boolean);
  return refs.filter(ref => ref.startsWith("/media/"));
}

function gameFinishMediaRefs(game) {
  const refs = [
    game?.finishMediaImage,
    game?.finishMediaAudio,
    game?.finishMediaVideo
  ].map(x => String(x || "").trim()).filter(Boolean);
  return refs.filter(ref => ref.startsWith("/media/"));
}

async function cleanupOrphanMediaForGame(gameId) {
  const id = Number(gameId || 0);
  if (!Number.isFinite(id) || id <= 0) return;

  const gameMediaDir = path.join(MEDIA_ROOT, String(id));
  const keep = new Set();
  const questions = await models.Question.findAll({
    where: { GameId: id },
    attributes: ["promptImage", "promptAudio", "promptVideo", "solutionImage", "solutionAudio", "solutionVideo"],
    include: [{ model: models.Option, attributes: ["image"] }]
  });
  for (const q of questions) {
    for (const ref of questionMediaRefs(q)) keep.add(ref);
  }
  const game = await models.Game.findByPk(id, {
    attributes: ["finishMediaImage", "finishMediaAudio", "finishMediaVideo"]
  });
  for (const ref of gameFinishMediaRefs(game)) keep.add(ref);

  const files = await listFilesRecursive(gameMediaDir);
  for (const abs of files) {
    const rel = path.relative(MEDIA_ROOT, abs).split(path.sep).join("/");
    if (!rel || rel.startsWith("..")) continue;
    const ref = `/media/${rel}`;
    if (!keep.has(ref)) await removeFileQuiet(abs);
  }

  await removeEmptyDirsRecursive(gameMediaDir);
}

async function removeGameMediaDir(gameId) {
  const id = Number(gameId || 0);
  if (!Number.isFinite(id) || id <= 0) return;
  const gameMediaDir = path.join(MEDIA_ROOT, String(id));
  try {
    await fsp.rm(gameMediaDir, { recursive: true, force: true });
  } catch {}
}

async function deleteGameWithDependencies(gameId) {
  const id = Number(gameId || 0);
  if (!Number.isFinite(id) || id <= 0) return false;

  const game = await models.Game.findByPk(id);
  if (!game) return false;

  const tx = await sequelize.transaction();
  try {
    const playerId = Number(game.PlayerId || 0);
    const questionIds = (await models.Question.findAll({
      where: { GameId: id },
      attributes: ["id"],
      transaction: tx
    })).map(q => Number(q.id)).filter(Number.isFinite);

    // Player vom Spiel entkoppeln, damit der FK-Zyklus Game<->Participant sauber auflösbar ist.
    if (Number.isFinite(playerId) && playerId > 0) {
      await models.Participant.update(
        { GameId: null },
        { where: { id: playerId }, transaction: tx }
      );
    }

    if (questionIds.length) {
      await models.Answer.destroy({ where: { QuestionId: questionIds }, transaction: tx });
    }
    await models.Link.destroy({ where: { GameId: id }, transaction: tx });
    await models.Question.destroy({ where: { GameId: id }, transaction: tx });
    await models.Participant.destroy({
      where: Number.isFinite(playerId) && playerId > 0
        ? { GameId: id, id: { [Op.ne]: playerId } }
        : { GameId: id },
      transaction: tx
    });

    const deletedCount = await models.Game.destroy({ where: { id }, transaction: tx });
    if (!deletedCount) throw new Error("game_not_found");

    if (Number.isFinite(playerId) && playerId > 0) {
      await models.Participant.destroy({ where: { id: playerId }, transaction: tx });
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  await removeGameMediaDir(id);
  return true;
}

async function optimizeUploadedImage(inputPath, outputPath) {
  const sharp = await getSharpLib();
  if (!sharp) return false;
  await sharp(inputPath, { failOn: "none", animated: false })
    .rotate()
    .resize({
      width: SOLUTION_IMAGE_MAX_EDGE,
      height: SOLUTION_IMAGE_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ quality: SOLUTION_IMAGE_QUALITY, effort: 4 })
    .toFile(outputPath);
  return true;
}

async function optimizeUploadedAudio(inputPath, outputPath) {
  if (!await hasFfmpeg()) return false;
  await runFfmpeg([
    "-i", inputPath,
    "-vn",
    "-c:a", "aac",
    "-b:a", `${FFMPEG_AUDIO_BITRATE_K}k`,
    "-movflags", "+faststart",
    outputPath
  ]);
  return true;
}

async function optimizeUploadedVideo(inputPath, outputPath) {
  if (!await hasFfmpeg()) return false;
  const scaleFilter = `scale=w=${FFMPEG_VIDEO_MAX_WIDTH}:h=${FFMPEG_VIDEO_MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  await runFfmpeg([
    "-i", inputPath,
    "-map_metadata", "-1",
    "-vf", scaleFilter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", String(FFMPEG_VIDEO_CRF),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", `${FFMPEG_AUDIO_BITRATE_K}k`,
    "-movflags", "+faststart",
    outputPath
  ]);
  return true;
}

async function storeUploadedMedia({ file, gameId, kindConfig }) {
  const mediaId = nanoid(20);
  const baseDirRel = safeRelMediaPath(String(gameId), kindConfig.kind);
  const baseDirAbs = path.join(MEDIA_ROOT, baseDirRel);
  await fsp.mkdir(baseDirAbs, { recursive: true });

  let ext = safeExtensionFromFilename(file?.originalname, ".bin");
  let finalFileName = `${mediaId}${ext}`;
  let finalAbsPath = path.join(baseDirAbs, finalFileName);
  let optimized = false;

  try {
    if (kindConfig.medium === "image") {
      finalFileName = `${mediaId}.webp`;
      finalAbsPath = path.join(baseDirAbs, finalFileName);
      try {
        optimized = await optimizeUploadedImage(file.path, finalAbsPath);
      } catch {
        optimized = false;
      }
      if (!optimized) {
        ext = safeExtensionFromFilename(file?.originalname, fallbackExtensionForMime(file?.mimetype, "image"));
        finalFileName = `${mediaId}${ext}`;
        finalAbsPath = path.join(baseDirAbs, finalFileName);
        await fsp.copyFile(file.path, finalAbsPath);
      }
    } else if (kindConfig.medium === "audio") {
      finalFileName = `${mediaId}.m4a`;
      finalAbsPath = path.join(baseDirAbs, finalFileName);
      try {
        optimized = await optimizeUploadedAudio(file.path, finalAbsPath);
      } catch {
        optimized = false;
      }
      if (!optimized) {
        ext = safeExtensionFromFilename(file?.originalname, fallbackExtensionForMime(file?.mimetype, "audio"));
        finalFileName = `${mediaId}${ext}`;
        finalAbsPath = path.join(baseDirAbs, finalFileName);
        await fsp.copyFile(file.path, finalAbsPath);
      }
    } else if (kindConfig.medium === "video") {
      finalFileName = `${mediaId}.mp4`;
      finalAbsPath = path.join(baseDirAbs, finalFileName);
      try {
        optimized = await optimizeUploadedVideo(file.path, finalAbsPath);
      } catch {
        optimized = false;
      }
      if (!optimized) {
        ext = safeExtensionFromFilename(file?.originalname, fallbackExtensionForMime(file?.mimetype, "video"));
        finalFileName = `${mediaId}${ext}`;
        finalAbsPath = path.join(baseDirAbs, finalFileName);
        await fsp.copyFile(file.path, finalAbsPath);
      }
    } else {
      await fsp.copyFile(file.path, finalAbsPath);
    }

    return {
      urlPath: `/media/${baseDirRel}/${finalFileName}`.replace(/\\/g, "/"),
      optimized
    };
  } finally {
    await removeFileQuiet(file.path);
  }
}

function mimeFromFilename(filename) {
  const ext = String(path.extname(String(filename || "")).toLowerCase());
  const map = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".flac": "audio/flac",
    ".opus": "audio/opus",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".ogv": "video/ogg"
  };
  return map[ext] || "application/octet-stream";
}

function mediaAbsPathFromUrlRef(rawRef) {
  const ref = String(rawRef || "").trim();
  if (!ref.startsWith("/media/")) return "";
  const pathname = ref.split("?")[0].split("#")[0];
  const rel = pathname.replace(/^\/media\//, "");
  const abs = path.resolve(MEDIA_ROOT, rel);
  const relFromRoot = path.relative(MEDIA_ROOT, abs);
  if (!relFromRoot || relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) return "";
  return abs;
}

async function mediaRefToEmbeddedDataUrl(rawRef) {
  const ref = String(rawRef || "").trim();
  if (!ref.startsWith("/media/")) return ref;
  const absPath = mediaAbsPathFromUrlRef(ref);
  if (!absPath) return ref;
  try {
    const bin = await fsp.readFile(absPath);
    const mime = mimeFromFilename(absPath);
    return `data:${mime};base64,${bin.toString("base64")}`;
  } catch {
    return ref;
  }
}

function parseDataUrl(raw) {
  const value = String(raw || "").trim();
  const m = value.match(/^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const mime = String(m[1] || "").toLowerCase();
  const base64 = String(m[2] || "").replace(/\s+/g, "");
  let buffer = null;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    buffer = null;
  }
  if (!buffer || !buffer.length) return null;
  const medium = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("video/")
        ? "video"
        : "";
  if (!medium) return null;
  return { mime, medium, buffer };
}

async function maybeImportDataUrlMedia(rawRef, { gameId, kind }) {
  const ref = String(rawRef || "").trim();
  if (!ref.startsWith("data:")) return ref;
  const parsed = parseDataUrl(ref);
  if (!parsed) return "";

  const baseKind = mediaKindConfig(kind);
  if (!baseKind) return "";
  if (baseKind.medium !== "any" && baseKind.medium !== parsed.medium) return "";

  const effectiveKind = baseKind.medium === "any"
    ? { ...baseKind, medium: parsed.medium, kind: `${baseKind.group}_${parsed.medium}` }
    : baseKind;

  const ext = fallbackExtensionForMime(parsed.mime, parsed.medium);
  const tmpPath = path.join(MEDIA_TMP_ROOT, `${nanoid(18)}${ext}`);

  try {
    await fsp.writeFile(tmpPath, parsed.buffer);
    const stored = await storeUploadedMedia({
      file: { path: tmpPath, originalname: `import${ext}`, mimetype: parsed.mime },
      gameId,
      kindConfig: effectiveKind
    });
    return stored.urlPath;
  } catch {
    await removeFileQuiet(tmpPath);
    return "";
  }
}

async function normalizeImportedQuestionMedia(rawQuestion, gameId) {
  const source = rawQuestion || {};
  const sourceOptions = Array.isArray(source.options) ? source.options : [];
  const options = [];
  for (const item of sourceOptions) {
    options.push({
      ...(item || {}),
      image: await maybeImportDataUrlMedia(item?.image, { gameId, kind: "option_image" })
    });
  }
  return {
    ...source,
    options,
    promptMedia: await maybeImportDataUrlMedia(source.promptMedia, { gameId, kind: "prompt_media" }),
    promptImage: await maybeImportDataUrlMedia(source.promptImage, { gameId, kind: "prompt_image" }),
    promptAudio: await maybeImportDataUrlMedia(source.promptAudio, { gameId, kind: "prompt_audio" }),
    promptVideo: await maybeImportDataUrlMedia(source.promptVideo, { gameId, kind: "prompt_video" }),
    solutionMedia: await maybeImportDataUrlMedia(source.solutionMedia, { gameId, kind: "solution_media" }),
    solutionImage: await maybeImportDataUrlMedia(source.solutionImage, { gameId, kind: "solution_image" }),
    solutionAudio: await maybeImportDataUrlMedia(source.solutionAudio, { gameId, kind: "solution_audio" }),
    solutionVideo: await maybeImportDataUrlMedia(source.solutionVideo, { gameId, kind: "solution_video" })
  };
}

function normalizePackageName(raw, fallback = "Question package") {
  const name = String(raw || "").trim().slice(0, 120);
  return name || fallback;
}

function normalizePackageDescription(raw) {
  return String(raw || "").trim().slice(0, 1200);
}

function isValidCustomPackageId(raw) {
  return /^[a-zA-Z0-9_-]{6,80}$/.test(String(raw || ""));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function questionToPackageQuestion(q) {
  const promptImage = await mediaRefToEmbeddedDataUrl(q.promptImage || "");
  const promptAudio = await mediaRefToEmbeddedDataUrl(q.promptAudio || "");
  const promptVideo = await mediaRefToEmbeddedDataUrl(q.promptVideo || "");
  const solutionImage = await mediaRefToEmbeddedDataUrl(q.solutionImage || "");
  const solutionAudio = await mediaRefToEmbeddedDataUrl(q.solutionAudio || "");
  const solutionVideo = await mediaRefToEmbeddedDataUrl(q.solutionVideo || "");
  const options = [];
  for (const [idx, o] of sortedOptions(q).entries()) {
    options.push({
      text: String(o.text || ""),
      image: await mediaRefToEmbeddedDataUrl(o.image || ""),
      isCorrect: !!o.isCorrect,
      orderIndex: Number.isFinite(Number(o.orderIndex)) ? Number(o.orderIndex) : idx
    });
  }
  return {
    text: String(q.text || ""),
    type: normalizeQuestionType(q.type),
    allowMultiple: !!q.allowMultiple,
    blockLabel: normalizeBlockLabel(q.blockLabel || "General"),
    guestCorrectThresholdPercent: normalizeGuestThresholdPercent(q.guestCorrectThresholdPercent),
    guestCorrectRule: normalizeGuestCorrectRule(q.guestCorrectRule),
    promptMedia: promptVideo || promptAudio || promptImage || "",
    promptImage,
    promptAudio,
    promptVideo,
    estimateTarget: q.estimateTarget === null || q.estimateTarget === undefined ? null : Number(q.estimateTarget),
    estimateTolerance: Number(q.estimateTolerance || 0),
    solutionType: q.solutionType || "none",
    solutionText: String(q.solutionText || ""),
    solutionMedia: solutionVideo || solutionAudio || solutionImage || "",
    solutionImage,
    solutionAudio,
    solutionVideo,
    options
  };
}

async function normalizedPayloadToPackageQuestion(q) {
  const promptImage = await mediaRefToEmbeddedDataUrl(q.promptImage || "");
  const promptAudio = await mediaRefToEmbeddedDataUrl(q.promptAudio || "");
  const promptVideo = await mediaRefToEmbeddedDataUrl(q.promptVideo || "");
  const solutionImage = await mediaRefToEmbeddedDataUrl(q.solutionImage || "");
  const solutionAudio = await mediaRefToEmbeddedDataUrl(q.solutionAudio || "");
  const solutionVideo = await mediaRefToEmbeddedDataUrl(q.solutionVideo || "");
  const options = [];
  for (const [idx, o] of (Array.isArray(q.options) ? q.options : []).entries()) {
    options.push({
      text: String(o.text || ""),
      image: await mediaRefToEmbeddedDataUrl(o.image || ""),
      isCorrect: !!o.isCorrect,
      orderIndex: Number.isFinite(Number(o.orderIndex)) ? Number(o.orderIndex) : idx
    });
  }
  return {
    text: String(q.text || ""),
    type: normalizeQuestionType(q.type),
    allowMultiple: !!q.allowMultiple,
    blockLabel: normalizeBlockLabel(q.blockLabel || "General"),
    guestCorrectThresholdPercent: normalizeGuestThresholdPercent(q.guestCorrectThresholdPercent),
    guestCorrectRule: normalizeGuestCorrectRule(q.guestCorrectRule),
    promptMedia: promptVideo || promptAudio || promptImage || "",
    promptImage,
    promptAudio,
    promptVideo,
    estimateTarget: q.estimateTarget === null || q.estimateTarget === undefined ? null : Number(q.estimateTarget),
    estimateTolerance: Number(q.estimateTolerance || 0),
    solutionType: q.solutionType || "none",
    solutionText: String(q.solutionText || ""),
    solutionMedia: solutionVideo || solutionAudio || solutionImage || "",
    solutionImage,
    solutionAudio,
    solutionVideo,
    options
  };
}

async function exportQuestionsForGame(gameId) {
  const full = await loadGameFull(models, gameId);
  const questions = full?.Questions || [];
  const out = [];
  for (const q of questions) {
    out.push(await questionToPackageQuestion(q));
  }
  return out;
}

async function exportFullGamePayload(gameId) {
  const game = await models.Game.findByPk(gameId);
  if (!game) return null;
  const full = await loadGameFull(models, gameId);
  const questions = await exportQuestionsForGame(gameId);
  return {
    format: "quizduell.full_game",
    version: FULL_GAME_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    game: {
      title: normalizeGameTitle(game.title, "Quiz"),
      playerName: String(full?.Player?.nickname || "Player").trim().slice(0, 80) || "Player",
      uiLanguage: normalizeUiLanguage(game.uiLanguage || "en"),
      isPublished: !!game.isPublished,
      showScore: game.showScore !== false,
      showQuizTitle: game.showQuizTitle !== false,
      showParticipantMedia: game.showParticipantMedia !== false,
      showTopPlayers: game.showTopPlayers !== false,
      autoRevealEnabled: game.autoRevealEnabled !== false,
      autoRevealDelaySeconds: normalizeAutoRevealDelaySeconds(game.autoRevealDelaySeconds),
      guestWinText: String(game.guestWinText || ""),
      playerWinText: String(game.playerWinText || ""),
      tieWinText: String(game.tieWinText || ""),
      finishMediaImage: await mediaRefToEmbeddedDataUrl(game.finishMediaImage || ""),
      finishMediaAudio: await mediaRefToEmbeddedDataUrl(game.finishMediaAudio || ""),
      finishMediaVideo: await mediaRefToEmbeddedDataUrl(game.finishMediaVideo || "")
    },
    questions
  };
}

function parseImportedFullGamePayload(raw) {
  const source = raw || {};
  const sourceGame = source?.game || {};
  const sourceQuestions = Array.isArray(source?.questions) ? source.questions : [];
  return {
    title: normalizeGameTitle(sourceGame?.title, "Imported quiz"),
    playerName: String(sourceGame?.playerName || "Player").trim().slice(0, 80) || "Player",
    uiLanguage: normalizeUiLanguage(sourceGame?.uiLanguage || "en"),
    isPublished: !!sourceGame?.isPublished,
    showScore: sourceGame?.showScore !== false,
    showQuizTitle: sourceGame?.showQuizTitle !== false,
    showParticipantMedia: sourceGame?.showParticipantMedia !== false,
    showTopPlayers: sourceGame?.showTopPlayers !== false,
    autoRevealEnabled: sourceGame?.autoRevealEnabled !== false,
    autoRevealDelaySeconds: normalizeAutoRevealDelaySeconds(sourceGame?.autoRevealDelaySeconds),
    guestWinText: String(sourceGame?.guestWinText || ""),
    playerWinText: String(sourceGame?.playerWinText || ""),
    tieWinText: String(sourceGame?.tieWinText || ""),
    finishMediaImage: String(sourceGame?.finishMediaImage || ""),
    finishMediaAudio: String(sourceGame?.finishMediaAudio || ""),
    finishMediaVideo: String(sourceGame?.finishMediaVideo || ""),
    questions: sourceQuestions
  };
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, "\"\"")}"`;
}

function buildQuestionsCsv(questions) {
  const header = [
    "text",
    "type",
    "allowMultiple",
    "blockLabel",
    "guestCorrectThresholdPercent",
    "guestCorrectRule",
    "estimateTarget",
    "estimateTolerance",
    "promptImage",
    "promptAudio",
    "promptVideo",
    "solutionType",
    "solutionText",
    "solutionImage",
    "solutionAudio",
    "solutionVideo",
    "optionsJson"
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const q of questions || []) {
    const options = Array.isArray(q.options) ? q.options : [];
    const row = [
      q.text || "",
      q.type || "choice",
      q.allowMultiple ? "1" : "0",
      q.blockLabel || "General",
      String(normalizeGuestThresholdPercent(q.guestCorrectThresholdPercent)),
      normalizeGuestCorrectRule(q.guestCorrectRule),
      q.estimateTarget === null || q.estimateTarget === undefined ? "" : String(q.estimateTarget),
      q.estimateTolerance === null || q.estimateTolerance === undefined ? "0" : String(q.estimateTolerance),
      q.promptImage || "",
      q.promptAudio || "",
      q.promptVideo || "",
      q.solutionType || "none",
      q.solutionText || "",
      q.solutionImage || "",
      q.solutionAudio || "",
      q.solutionVideo || "",
      JSON.stringify(options)
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function parseCsvRows(text) {
  const input = String(text || "");
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (input[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (ch !== "\r") field += ch;
    i += 1;
  }

  if (inQuotes) throw new Error("invalid_csv_quotes");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(x => String(x || "").trim() !== ""));
}

function parseQuestionsCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];

  const header = rows[0].map(x => String(x || "").trim());
  const idxByKey = new Map(header.map((k, idx) => [k, idx]));
  const must = ["text", "type", "allowMultiple", "blockLabel", "optionsJson"];
  for (const key of must) {
    if (!idxByKey.has(key)) throw new Error(`missing_csv_column_${key}`);
  }

  const questions = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (key, fallback = "") => {
      const idx = idxByKey.get(key);
      if (idx === undefined) return fallback;
      return r[idx] ?? fallback;
    };
    const textVal = String(get("text", "") || "").trim();
    if (!textVal) continue;

    const allowMultipleRaw = String(get("allowMultiple", "0")).trim().toLowerCase();
    const allowMultiple = ["1", "true", "yes", "ja"].includes(allowMultipleRaw);

    let options = [];
    try {
      const parsed = JSON.parse(String(get("optionsJson", "[]") || "[]"));
      if (Array.isArray(parsed)) options = parsed;
    } catch {
      options = [];
    }

    const estimateTargetRaw = String(get("estimateTarget", "")).trim();
    const estimateToleranceRaw = String(get("estimateTolerance", "0")).trim();
    const estimateTarget = estimateTargetRaw === "" ? null : Number(estimateTargetRaw);
    const estimateTolerance = estimateToleranceRaw === "" ? 0 : Number(estimateToleranceRaw);

    questions.push({
      text: textVal,
      type: String(get("type", "choice") || "choice"),
      allowMultiple,
      blockLabel: String(get("blockLabel", "General") || "General"),
      guestCorrectThresholdPercent: normalizeGuestThresholdPercent(get("guestCorrectThresholdPercent", "50")),
      guestCorrectRule: normalizeGuestCorrectRule(get("guestCorrectRule", "threshold")),
      estimateTarget: Number.isFinite(estimateTarget) ? estimateTarget : null,
      estimateTolerance: Number.isFinite(estimateTolerance) ? estimateTolerance : 0,
      promptImage: String(get("promptImage", "") || ""),
      promptAudio: String(get("promptAudio", "") || ""),
      promptVideo: String(get("promptVideo", "") || ""),
      solutionType: String(get("solutionType", "none") || "none"),
      solutionText: String(get("solutionText", "") || ""),
      solutionImage: String(get("solutionImage", "") || ""),
      solutionAudio: String(get("solutionAudio", "") || ""),
      solutionVideo: String(get("solutionVideo", "") || ""),
      options: Array.isArray(options) ? options : []
    });
  }

  return questions;
}

function normalizePackagePayload(raw, fallbackName = "Imported question package") {
  const source = raw || {};
  const list = Array.isArray(source)
    ? source
    : Array.isArray(source.questions)
      ? source.questions
      : [];
  const safeIso = (value) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  };
  return {
    version: Number(source.version || QUESTION_PACKAGE_VERSION),
    id: String(source.id || ""),
    kind: String(source.kind || "custom"),
    name: normalizePackageName(source.name, fallbackName),
    description: normalizePackageDescription(source.description || ""),
    createdAt: source.createdAt ? safeIso(source.createdAt) : new Date().toISOString(),
    updatedAt: source.updatedAt ? safeIso(source.updatedAt) : new Date().toISOString(),
    questions: list
  };
}

function customPackageFilePath(id) {
  if (!isValidCustomPackageId(id)) return "";
  return path.join(QUESTION_PACKAGES_ROOT, `${id}.json`);
}

async function readCustomPackageById(id) {
  const filePath = customPackageFilePath(id);
  if (!filePath) return null;
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizePackagePayload(parsed, "Question package");
    normalized.id = id;
    normalized.kind = "custom";
    return normalized;
  } catch {
    return null;
  }
}

async function listCustomPackages() {
  let files = [];
  try {
    files = await fsp.readdir(QUESTION_PACKAGES_ROOT);
  } catch {
    files = [];
  }
  const out = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    const pkg = await readCustomPackageById(id);
    if (!pkg) continue;
    out.push(pkg);
  }
  return out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

async function saveCustomPackage(payload) {
  const now = new Date().toISOString();
  const requestedId = String(payload?.id || "").trim();
  const id = isValidCustomPackageId(requestedId) ? requestedId : `pkg_${nanoid(12)}`;
  const prev = await readCustomPackageById(id);
  const normalized = normalizePackagePayload(payload, "Question package");
  normalized.id = id;
  normalized.kind = "custom";
  normalized.createdAt = prev?.createdAt || now;
  normalized.updatedAt = now;

  const filePath = customPackageFilePath(id);
  if (!filePath) throw new Error("invalid_package_id");
  await fsp.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

async function loadQuestionPackageById(packageId) {
  const id = String(packageId || "").trim();
  if (!id) return null;
  if (id.startsWith("builtin:")) {
    const builtin = BUILTIN_PACKAGE_BY_ID.get(id);
    if (!builtin) return null;
    return normalizePackagePayload(deepClone(builtin), builtin.name);
  }
  return readCustomPackageById(id);
}

function packageListEntry(pkg) {
  return {
    id: pkg.id,
    kind: pkg.kind || "custom",
    name: normalizePackageName(pkg.name),
    description: normalizePackageDescription(pkg.description),
    questionCount: Array.isArray(pkg.questions) ? pkg.questions.length : 0,
    updatedAt: pkg.updatedAt || pkg.createdAt || null
  };
}

async function normalizePackageQuestionsForInsert(rawQuestions, gameId) {
  const source = Array.isArray(rawQuestions) ? rawQuestions : [];
  const out = [];

  for (const item of source) {
    const withMedia = await normalizeImportedQuestionMedia(item || {}, gameId);
    const payload = await normalizeQuestionPayload(withMedia);
    const validationError = validateQuestionPayload(payload);
    if (validationError) throw new Error(validationError);
    out.push(payload);
  }
  return out;
}

async function insertQuestionsIntoGame(gameId, normalizedQuestions, { mode = "replace" } = {}) {
  const game = await models.Game.findByPk(gameId);
  if (!game) throw new Error("game_not_found");

  const cleanMode = mode === "append" ? "append" : "replace";
  if (cleanMode === "replace" && game.status === "live") throw new Error("game_live");

  clearAutoRevealTimer(gameId);

  let sortBase = 0;
  if (cleanMode === "replace") {
    await models.Question.destroy({ where: { GameId: gameId } });
    await models.Game.update(
      { currentQuestionIndex: 0, revealedQuestionIndex: -1, phase: "answering", winner: null, status: "setup" },
      { where: { id: gameId } }
    );
  } else {
    const maxSortOrder = await models.Question.max("sortOrder", { where: { GameId: gameId } });
    sortBase = Number.isFinite(Number(maxSortOrder)) ? Number(maxSortOrder) + 1 : 0;
  }

  for (let i = 0; i < normalizedQuestions.length; i++) {
    const q = normalizedQuestions[i];
    const created = await models.Question.create({
      GameId: gameId,
      text: q.text,
      type: q.type,
      allowMultiple: q.allowMultiple,
      sortOrder: sortBase + i,
      blockLabel: q.blockLabel,
      promptImage: q.promptImage,
      promptAudio: q.promptAudio,
      promptVideo: q.promptVideo,
      guestCorrectThresholdPercent: normalizeGuestThresholdPercent(q.guestCorrectThresholdPercent),
      guestCorrectRule: normalizeGuestCorrectRule(q.guestCorrectRule),
      estimateTarget: q.type === "estimate" ? q.estimateTarget : null,
      estimateTolerance: q.type === "estimate" ? q.estimateTolerance : 0,
      solutionType: q.solutionType,
      solutionText: q.solutionText,
      solutionImage: q.solutionImage,
      solutionAudio: q.solutionAudio,
      solutionVideo: q.solutionVideo
    });
    for (const opt of q.options) {
      await models.Option.create({
        QuestionId: created.id,
        text: opt.text,
        image: opt.image || "",
        isCorrect: !!opt.isCorrect,
        orderIndex: Number(opt.orderIndex || 0)
      });
    }
  }

  await emitGameState(gameId);
  await cleanupOrphanMediaForGame(gameId);
}

function hasSubmittedAnswerTokens(questionType, tokens, optionCount = 0) {
  const type = normalizeQuestionType(questionType);
  const arr = Array.isArray(tokens) ? tokens : [];
  if (type === "estimate") return Number.isFinite(Number(arr[0]));
  if (type === "order") return arr.length === optionCount && optionCount > 0;
  return arr.length > 0;
}

function clearAutoRevealTimer(gameId) {
  const key = String(gameId);
  const timer = autoRevealTimers.get(key);
  if (timer) {
    clearTimeout(timer.timeoutId);
    autoRevealTimers.delete(key);
  }
  clearScheduledGameStateEmit(gameId);
}

async function canAutoRevealNow(gameId, expectedQuestionId = null) {
  const game = await models.Game.findByPk(gameId);
  if (!game || game.status !== "live" || game.phase !== "answering") return { canReveal: false, questionId: null };
  if (game.autoRevealEnabled === false) return { canReveal: false, questionId: null };

  const full = await loadGameFull(models, gameId);
  const question = full?.Questions?.[game.currentQuestionIndex];
  if (!question) return { canReveal: false, questionId: null };
  if (expectedQuestionId && Number(expectedQuestionId) !== Number(question.id)) return { canReveal: false, questionId: question.id };

  const guests = await models.Participant.findAll({
    where: { GameId: gameId, kind: "guest" },
    attributes: ["id"]
  });
  const participantIds = [game.PlayerId, ...guests.map(g => g.id)];
  const answers = participantIds.length
    ? await models.Answer.findAll({
      where: { QuestionId: question.id, ParticipantId: participantIds },
      attributes: ["ParticipantId", "optionIds"]
    })
    : [];
  const byParticipant = new Map(answers.map(a => [Number(a.ParticipantId), a]));

  for (const participantId of participantIds) {
    const answer = byParticipant.get(Number(participantId));
    if (!answer) return { canReveal: false, questionId: question.id };
    const tokens = parseAnswerTokens(question, answer.optionIds);
    if (!hasSubmittedAnswerTokens(question.type, tokens, (question?.Options || []).length)) {
      return { canReveal: false, questionId: question.id };
    }
  }

  return { canReveal: participantIds.length > 0, questionId: question.id };
}

async function scheduleAutoRevealIfReady(gameId) {
  const key = String(gameId);
  if (autoRevealTimers.has(key)) return false;
  const game = await models.Game.findByPk(gameId);
  if (!game || game.autoRevealEnabled === false) return false;
  const delayMs = autoRevealDelayMsForGame(game);

  const check = await canAutoRevealNow(gameId);
  if (!check.canReveal || !check.questionId) return false;

  io.to(gameRoom(gameId)).emit("auto_reveal_countdown", {
    questionId: check.questionId,
    delayMs
  });

  const timeoutId = setTimeout(async () => {
    autoRevealTimers.delete(key);
    const verify = await canAutoRevealNow(gameId, check.questionId);
    if (!verify.canReveal) return;
    await models.Game.update(
      { phase: "revealed", revealedQuestionIndex: (await models.Game.findByPk(gameId))?.currentQuestionIndex ?? 0 },
      { where: { id: gameId, status: "live", phase: "answering" } }
    );
    await emitGameState(gameId);
  }, delayMs);

  autoRevealTimers.set(key, { questionId: check.questionId, timeoutId });
  return true;
}

function adminSessionExpiresAt(fromMs = Date.now()) {
  return new Date(fromMs + ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000);
}

function hashAdminSessionToken(token) {
  return crypto.createHash("sha256").update(`${APP_SECRET}:${String(token || "")}`).digest("hex");
}

function clientIp(req) {
  const fwd = String(req.get("x-forwarded-for") || "").split(",")[0].trim();
  return fwd || req.ip || "unknown";
}

function pruneLoginAttempts(ip) {
  const now = Date.now();
  const entries = (loginAttemptsByIp.get(ip) || []).filter(ts => now - ts <= LOGIN_RATE_LIMIT_WINDOW_MS);
  if (entries.length) loginAttemptsByIp.set(ip, entries);
  else loginAttemptsByIp.delete(ip);
  return entries;
}

function isLoginRateLimited(ip) {
  return pruneLoginAttempts(ip).length >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
}

function markLoginFailure(ip) {
  const entries = pruneLoginAttempts(ip);
  entries.push(Date.now());
  loginAttemptsByIp.set(ip, entries);
}

function clearLoginFailures(ip) {
  loginAttemptsByIp.delete(ip);
}

function extractAdminSessionToken(req) {
  const fromHeader = String(req.get("x-admin-session") || "").trim();
  if (fromHeader) return fromHeader;
  const auth = String(req.get("authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

async function cleanupExpiredAdminSessions() {
  try {
    await models.AdminSession.destroy({
      where: {
        [Op.or]: [
          { expiresAt: { [Op.lt]: new Date() } },
          { revokedAt: { [Op.not]: null } }
        ]
      }
    });
  } catch {}
}

async function createAdminSession(req) {
  const rawToken = nanoid(48);
  const tokenHash = hashAdminSessionToken(rawToken);
  const expiresAt = adminSessionExpiresAt();
  const session = await models.AdminSession.create({
    tokenHash,
    expiresAt,
    lastSeenAt: new Date(),
    createdFromIp: clientIp(req)
  });
  return { rawToken, session };
}

async function requireMasterAdmin(req, res, next) {
  try {
    const token = extractAdminSessionToken(req);
    if (!token) return res.status(401).json({ error: "missing_admin_session" });

    const tokenHash = hashAdminSessionToken(token);
    const session = await models.AdminSession.findOne({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { [Op.gt]: new Date() }
      }
    });
    if (!session) return res.status(401).json({ error: "invalid_admin_session" });

    await session.update({
      lastSeenAt: new Date(),
      expiresAt: adminSessionExpiresAt()
    });
    req.adminSession = session;
    req.adminSessionHash = tokenHash;
    return next();
  } catch (err) {
    return res.status(500).json({ error: "auth_error", detail: err?.message || String(err) });
  }
}

function normalizeQuestionType(raw) {
  const t = String(raw || "choice").trim().toLowerCase();
  if (QUESTION_TYPES.has(t)) return t;
  return "choice";
}

function sortedOptions(question) {
  return [...(question?.Options || [])].sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0) || Number(a.id || 0) - Number(b.id || 0));
}

function parseAnswerTokens(question, optionIdsRaw) {
  const type = normalizeQuestionType(question?.type);
  const raw = String(optionIdsRaw || "");
  if (type === "estimate") {
    const first = raw.split(",")[0]?.trim();
    return first ? [first] : [];
  }
  return raw.split(",").map(String).map(s => s.trim()).filter(Boolean);
}

function mapQuestionForSocket(question) {
  return {
    id: question.id,
    text: question.text,
    type: normalizeQuestionType(question.type),
    allowMultiple: !!question.allowMultiple,
    blockLabel: String(question.blockLabel || "General"),
    promptImage: String(question.promptImage || ""),
    promptAudio: String(question.promptAudio || ""),
    promptVideo: String(question.promptVideo || ""),
    estimateTolerance: Number(question.estimateTolerance || 0),
    guestCorrectThresholdPercent: normalizeGuestThresholdPercent(question.guestCorrectThresholdPercent),
    guestCorrectRule: normalizeGuestCorrectRule(question.guestCorrectRule),
    solutionType: question.solutionType || "none",
    options: sortedOptions(question).map(o => ({ id: o.id, text: o.text, image: String(o.image || "") }))
  };
}

function median(values) {
  const arr = [...(values || [])].filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2) return arr[mid];
  return (arr[mid - 1] + arr[mid]) / 2;
}

async function ensureResultsLink(gameId) {
  const existing = await models.Link.findOne({ where: { GameId: gameId, type: "results" } });
  if (existing) return existing;
  return models.Link.create({ GameId: gameId, type: "results", token: nanoid(16) });
}

function gameLanguage(game) {
  return normalizeUiLanguage(game?.uiLanguage || "en");
}

function tr(game, source, vars = {}) {
  return translate(gameLanguage(game), source, vars);
}

function winnerLabel(game, playerName) {
  if (game?.winner === "player") return playerName;
  if (game?.winner === "guests") return tr(game, "Guests");
  if (game?.winner === "tie") return tr(game, "Tie");
  return tr(game, "Open");
}

function winnerText(game) {
  if (game?.winner === "player") return String(game?.playerWinText || "");
  if (game?.winner === "guests") return String(game?.guestWinText || "");
  if (game?.winner === "tie") return String(game?.tieWinText || "");
  return "";
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(value, maxLen) {
  const s = String(value || "").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
}

async function buildResultsPayload(gameId) {
  return buildResultsPayloadWithPersonal(gameId, {});
}

function buildPersonalResult(game, rankingsWithIds, participantId, playerName) {
  const id = Number(participantId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  const idx = rankingsWithIds.findIndex(r => Number(r.id) === id);
  if (idx < 0) return null;
  const row = rankingsWithIds[idx];
  const rank = idx + 1;
  const total = rankingsWithIds.length;
  return {
    participantId: id,
    nickname: row.nickname || `Guest ${id}`,
    rank,
    total,
    score: Number(row.score || 0),
    text: rank === 1
      ? tr(game, "You know {playerName} best. Rank {rank} of {total}.", {
        playerName: playerName || tr(game, "the player"),
        rank,
        total
      })
      : tr(game, "Rank {rank} of {total}.", { rank, total })
  };
}

async function buildResultsPayloadWithPersonal(gameId, { participantId = null } = {}) {
  const game = await models.Game.findByPk(gameId);
  if (!game) return null;
  const language = gameLanguage(game);
  const full = await loadGameFull(models, gameId);
  const score = await computeScore(models, gameId, { uptoIndex: game.revealedQuestionIndex });
  const playerName = full?.Player?.nickname || score?.playerName || "Player";
  const rankingsWithIds = (score?.rankings || []).map((r, idx) => ({
    id: Number(r.id || 0),
    rank: idx + 1,
    nickname: r.nickname || `Guest ${r.id}`,
    score: Number(r.score || 0)
  }));
  const rankings = rankingsWithIds.map(({ rank, nickname, score: s }) => ({ rank, nickname, score: s }));
  const personal = buildPersonalResult(game, rankingsWithIds, participantId, playerName);

  return {
    title: game.title || "Quiz Duel",
    language,
    status: game.status,
    winner: winnerLabel(game, playerName),
    winnerText: winnerText(game),
    playerName,
    score: {
      player: Number(score?.player || 0),
      guests: Number(score?.guests || 0)
    },
    rankings,
    personal
  };
}

function buildResultsSvg(payload) {
  const language = normalizeUiLanguage(payload?.language || "en");
  const translateSvg = (source, vars = {}) => translate(language, source, vars);
  const width = 1200;
  const height = 630;
  const safeTitle = escapeXml(truncateText(payload.title, 58));
  const safeWinner = escapeXml(truncateText(payload.winner, 36));
  const safeWinnerText = escapeXml(truncateText(payload.winnerText || "", 120));
  const safePlayerName = escapeXml(truncateText(payload.playerName, 24));
  const personal = payload.personal || null;
  const rows = payload.rankings.slice(0, 5);

  const rankingRows = rows.map((row, idx) => {
    const y = 254 + idx * 62;
    const safeNick = escapeXml(truncateText(row.nickname, 26));
    return `
      <rect x="44" y="${y}" width="730" height="50" rx="12" fill="#ffffff" fill-opacity="0.95"/>
      <text x="66" y="${y + 32}" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="24" font-weight="700" fill="#1f2937">#${row.rank}</text>
      <text x="138" y="${y + 32}" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="24" font-weight="800" fill="#111827">${safeNick}</text>
      <text x="738" y="${y + 32}" text-anchor="end" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="24" font-weight="800" fill="#004e96">${row.score} ${escapeXml(translateSvg("pts."))}</text>
    `;
  }).join("");

  const personalCard = personal
    ? `
      <rect x="850" y="320" width="320" height="262" rx="20" fill="#ffffff" fill-opacity="0.95" stroke="#93c5fd"/>
      <text x="872" y="360" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="20" font-weight="900" fill="#0f172a">${escapeXml(translateSvg("Your card"))}</text>
      <text x="872" y="398" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="30" font-weight="900" fill="#004e96">#${personal.rank}</text>
      <text x="930" y="398" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="22" font-weight="800" fill="#111827">${escapeXml(truncateText(personal.nickname, 18))}</text>
      <text x="872" y="440" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="16" font-weight="700" fill="#475569">${escapeXml(translateSvg("Points"))}</text>
      <text x="1140" y="440" text-anchor="end" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="24" font-weight="900" fill="#004e96">${personal.score}</text>
      <text x="872" y="476" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="15" font-weight="700" fill="#1e293b">${escapeXml(translateSvg("Rank {rank} of {total}", { rank: personal.rank, total: personal.total }))}</text>
      <text x="872" y="512" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="14" font-weight="600" fill="#334155">${escapeXml(truncateText(personal.text || "", 64))}</text>
    `
    : `
      <rect x="850" y="320" width="320" height="262" rx="20" fill="#ffffff" fill-opacity="0.95" stroke="#c7d2fe"/>
      <text x="872" y="362" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="20" font-weight="900" fill="#0f172a">${escapeXml(translateSvg("Quiz Duel Results"))}</text>
      <text x="872" y="394" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="16" font-weight="700" fill="#475569">${escapeXml(translateSvg("Share this score as link or PNG."))}</text>
      <text x="872" y="434" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="15" fill="#1e293b">${escapeXml(translateSvg("Status"))}: ${escapeXml(payload.status)}</text>
    `;

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f0f7ff"/>
          <stop offset="100%" stop-color="#dbeafe"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <rect x="30" y="26" width="780" height="578" rx="22" fill="#e7f1ff" stroke="#004e96" stroke-width="2"/>
      <text x="44" y="84" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="42" font-weight="900" fill="#004e96">${safeTitle}</text>
      <text x="44" y="132" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="28" font-weight="700" fill="#0f172a">${escapeXml(translateSvg("Winner"))}: ${safeWinner}</text>
      <text x="44" y="174" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="20" font-weight="600" fill="#334155">${safeWinnerText}</text>
      <text x="44" y="228" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="18" font-weight="900" fill="#004e96">${escapeXml(translateSvg("Top ranking"))}</text>
      ${rankingRows}

      <rect x="850" y="70" width="320" height="220" rx="20" fill="#ffffff" fill-opacity="0.95" stroke="#c7d2fe"/>
      <text x="872" y="112" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="22" font-weight="900" fill="#111827">${escapeXml(translateSvg("Score"))}</text>
      <text x="872" y="156" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="20" font-weight="700" fill="#e10011">${safePlayerName}</text>
      <text x="1140" y="156" text-anchor="end" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="26" font-weight="900" fill="#e10011">${payload.score.player}</text>
      <text x="872" y="204" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="20" font-weight="700" fill="#004e96">${escapeXml(translateSvg("Guests"))}</text>
      <text x="1140" y="204" text-anchor="end" font-family="DejaVu Sans, Liberation Sans, Noto Sans, sans-serif" font-size="26" font-weight="900" fill="#004e96">${payload.score.guests}</text>

      ${personalCard}
    </svg>
  `;
}

async function buildRevealPayload({ gameId, game, full }) {
  if (game.phase !== "revealed" || !full?.Questions?.[game.currentQuestionIndex]) return null;

  const q = full.Questions[game.currentQuestionIndex];
  const type = normalizeQuestionType(q.type);
  const options = sortedOptions(q);
  const correct = CHOICE_LIKE_TYPES.has(type)
    ? options.filter(o => o.isCorrect).map(o => ({ id: o.id, text: o.text }))
    : [];
  const correctOrder = type === "order"
    ? options.map(o => ({ id: o.id, text: o.text }))
    : [];
  const guestVotes = await computeGuestVoteCounts(models, { gameId, question: q });
  const playerAnswer = await models.Answer.findOne({
    where: { QuestionId: q.id, ParticipantId: game.PlayerId }
  });

  let estimate = null;
  if (type === "estimate") {
    const guests = await models.Participant.findAll({ where: { GameId: gameId, kind: "guest" }, attributes: ["id"] });
    const guestIds = guests.map(g => g.id);
    const guestAnswers = guestIds.length
      ? await models.Answer.findAll({ where: { QuestionId: q.id, ParticipantId: guestIds } })
      : [];
    const guestValues = guestAnswers
      .map(a => Number(parseAnswerTokens(q, a.optionIds)[0]))
      .filter(v => Number.isFinite(v));
    const target = Number(q.estimateTarget);
    const playerGuess = Number(parseAnswerTokens(q, playerAnswer?.optionIds || "")[0]);
    estimate = {
      target: Number.isFinite(target) ? target : null,
      tolerance: Math.max(0, Number(q.estimateTolerance || 0)),
      playerGuess: Number.isFinite(playerGuess) ? playerGuess : null,
      guestMedian: median(guestValues)
    };
  }

  return {
    questionId: q.id,
    questionType: type,
    correct,
    correctOrder,
    guestVotes,
    playerAnswer: playerAnswer ? parseAnswerTokens(q, playerAnswer.optionIds) : [],
    estimate,
    solution: {
      type: q.solutionType || "none",
      text: q.solutionText || "",
      image: q.solutionImage || "",
      audio: q.solutionAudio || "",
      video: q.solutionVideo || ""
    }
  };
}

async function buildRealtimeStatePayload(gameId, { rankingLimit = LIVE_SCORE_RANKING_LIMIT } = {}) {
  const game = await models.Game.findByPk(gameId);
  if (!game) return null;

  const full = await loadGameFull(models, gameId);
  if (!full) return null;

  // Score wird nur bis zur zuletzt "revealed" Frage gezählt
  const score = await computeScore(models, gameId, {
    uptoIndex: game.revealedQuestionIndex,
    rankingLimit: rankingLimit > 0 ? rankingLimit : null
  });

  const guestParticipants = await models.Participant.findAll({
    where: { GameId: gameId, kind: "guest" },
    attributes: ["id"]
  });
  const guestIdList = guestParticipants.map(g => g.id);
  const guestCount = guestIdList.length;

  // Live-Progress für aktuelle Frage berechnen
  const progress = { guestAnsweredCount: 0, guestTotal: guestCount, playerAnswered: false, playerSelection: [] };
  const currentQ = full?.Questions?.[game.currentQuestionIndex];
  if (currentQ) {
    if (guestIdList.length) {
      progress.guestAnsweredCount = await models.Answer.count({ where: { QuestionId: currentQ.id, ParticipantId: guestIdList } });
    }
    const playerAns = await models.Answer.findOne({ where: { QuestionId: currentQ.id, ParticipantId: game.PlayerId } });
    progress.playerAnswered = !!playerAns;
    progress.playerSelection = playerAns ? parseAnswerTokens(currentQ, playerAns.optionIds) : [];
  }

  const gameStatePayload = {
    game: {
      id: game.id,
      title: game.title,
      uiLanguage: normalizeUiLanguage(game.uiLanguage || "en"),
      isPublished: game.isPublished,
      status: game.status,
      currentQuestionIndex: game.currentQuestionIndex,
      phase: game.phase,
      revealedQuestionIndex: game.revealedQuestionIndex,
      playerId: game.PlayerId,

      winner: game.winner,
      guestWinText: game.guestWinText,
      playerWinText: game.playerWinText,
      tieWinText: game.tieWinText,
      finishMediaImage: String(game.finishMediaImage || ""),
      finishMediaAudio: String(game.finishMediaAudio || ""),
      finishMediaVideo: String(game.finishMediaVideo || ""),
      showScore: game.showScore,
      showQuizTitle: game.showQuizTitle !== false,
      showParticipantMedia: game.showParticipantMedia !== false,
      showTopPlayers: game.showTopPlayers !== false,
      autoRevealEnabled: game.autoRevealEnabled !== false,
      autoRevealDelaySeconds: normalizeAutoRevealDelaySeconds(game.autoRevealDelaySeconds),
      lastStartedAt: game.lastStartedAt,
      guestCount
    },
    player: full?.Player ? { id: full.Player.id, nickname: full.Player.nickname } : null,
    questions: full?.Questions?.map(mapQuestionForSocket) || [],
    score,
    progress
  };

  const revealPayload = await buildRevealPayload({ gameId, game, full });
  return { gameStatePayload, revealPayload };
}

async function emitGameState(gameId, { rankingLimit = LIVE_SCORE_RANKING_LIMIT } = {}) {
  clearScheduledGameStateEmit(gameId);
  const state = await buildRealtimeStatePayload(gameId, { rankingLimit });
  if (!state) return false;
  io.to(gameRoom(gameId)).emit("game_state", state.gameStatePayload);
  if (state.revealPayload) {
    io.to(gameRoom(gameId)).emit("reveal", state.revealPayload);
  }
  return true;
}

async function emitGameStateToSocket(socket, gameId, { rankingLimit = LIVE_SCORE_RANKING_LIMIT } = {}) {
  const state = await buildRealtimeStatePayload(gameId, { rankingLimit });
  if (!state) return false;
  socket.emit("game_state", state.gameStatePayload);
  if (state.revealPayload) {
    socket.emit("reveal", state.revealPayload);
  }
  return true;
}

function clearScheduledGameStateEmit(gameId) {
  const key = String(gameId);
  const timer = gameStateEmitTimers.get(key);
  if (!timer) return;
  clearTimeout(timer.timeoutId);
  gameStateEmitTimers.delete(key);
}

function scheduleEmitGameState(gameId, { delayMs = GAME_STATE_THROTTLE_MS } = {}) {
  const key = String(gameId);
  if (gameStateEmitTimers.has(key)) return false;
  const timeoutId = setTimeout(async () => {
    gameStateEmitTimers.delete(key);
    try {
      await emitGameState(gameId);
    } catch (err) {
      logCompactError("scheduled game_state emit failed", err);
    }
  }, Math.max(0, Number(delayMs || 0)));
  gameStateEmitTimers.set(key, { timeoutId, createdAt: Date.now() });
  return true;
}

async function requireToken(req, res, next) {
  const token = req.params.token || req.query.token;
  const data = await getGameByToken(models, token);
  if (!data) return res.status(404).json({ error: "invalid_token" });
  req.link = data.link;
  req.game = data.game;
  next();
}

async function optimizeImageDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return String(dataUrl || "");

  const inputMime = m[1].toLowerCase();
  const base64 = m[2] || "";
  if (!base64) return "";

  let input;
  try {
    input = Buffer.from(base64, "base64");
  } catch {
    return "";
  }
  if (!input?.length) return "";

  // SVG/ICO etc. nicht anfassen, nur Rasterbilder komprimieren.
  const raster = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/tiff", "image/gif"];
  if (!raster.includes(inputMime)) return String(dataUrl || "");

  const sharp = await getSharpLib();
  if (!sharp) return String(dataUrl || "");

  try {
    const output = await sharp(input, { failOn: "none", animated: false })
      .rotate()
      .resize({
        width: SOLUTION_IMAGE_MAX_EDGE,
        height: SOLUTION_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: SOLUTION_IMAGE_QUALITY, effort: 4 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch {
    return String(dataUrl || "");
  }
}

async function normalizeQuestionSolution(raw = {}) {
  const solutionText = String(raw.solutionText || "").trim().slice(0, 5000);
  let solutionImage = String(raw.solutionImage || "").trim();
  let solutionAudio = String(raw.solutionAudio || "").trim();
  let solutionVideo = String(raw.solutionVideo || "").trim();
  const solutionMedia = normalizeMediaUrlRef(raw.solutionMedia, { allowImageDataUrl: true });

  if (solutionMedia) {
    const medium = inferMediumFromMediaRef(solutionMedia);
    if (medium === "image") {
      solutionImage = solutionMedia;
      solutionAudio = "";
      solutionVideo = "";
    } else if (medium === "audio") {
      solutionImage = "";
      solutionAudio = solutionMedia;
      solutionVideo = "";
    } else if (medium === "video") {
      solutionImage = "";
      solutionAudio = "";
      solutionVideo = solutionMedia;
    }
  }

  if (solutionImage.startsWith("data:image/")) {
    solutionImage = await optimizeImageDataUrl(solutionImage);
  }

  const hasMedia = !!(solutionImage || solutionAudio || solutionVideo);
  let solutionType = "none";
  if (solutionText && hasMedia) solutionType = "both";
  else if (solutionText) solutionType = "text";
  else if (hasMedia) solutionType = "image";

  return {
    solutionType,
    solutionText,
    solutionImage,
    solutionAudio,
    solutionVideo
  };
}

function normalizeBlockLabel(raw) {
  const block = String(raw || "").trim().slice(0, 120);
  return block || "General";
}

function normalizeMediaUrlRef(raw, { allowImageDataUrl = false } = {}) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (allowImageDataUrl && value.startsWith("data:image/")) return value;
  if (value.startsWith("/media/")) return value;
  if (/^https?:\/\//i.test(value)) return value.slice(0, 4000);
  return "";
}

function normalizeFinishMediaPayload(raw = {}) {
  let finishMediaImage = normalizeMediaUrlRef(raw.finishMediaImage);
  let finishMediaAudio = normalizeMediaUrlRef(raw.finishMediaAudio);
  let finishMediaVideo = normalizeMediaUrlRef(raw.finishMediaVideo);
  const finishMedia = normalizeMediaUrlRef(raw.finishMedia);
  if (finishMedia) {
    const medium = inferMediumFromMediaRef(finishMedia);
    if (medium === "image") {
      finishMediaImage = finishMedia;
      finishMediaAudio = "";
      finishMediaVideo = "";
    } else if (medium === "audio") {
      finishMediaImage = "";
      finishMediaAudio = finishMedia;
      finishMediaVideo = "";
    } else if (medium === "video") {
      finishMediaImage = "";
      finishMediaAudio = "";
      finishMediaVideo = finishMedia;
    }
  }
  return {
    finishMediaImage,
    finishMediaAudio,
    finishMediaVideo
  };
}

async function normalizeImportedFinishMedia(raw = {}, gameId) {
  const source = raw || {};
  let finishMediaImage = await maybeImportDataUrlMedia(source.finishMediaImage, { gameId, kind: "finish_image" });
  let finishMediaAudio = await maybeImportDataUrlMedia(source.finishMediaAudio, { gameId, kind: "finish_audio" });
  let finishMediaVideo = await maybeImportDataUrlMedia(source.finishMediaVideo, { gameId, kind: "finish_video" });
  const finishMedia = await maybeImportDataUrlMedia(source.finishMedia, { gameId, kind: "finish_media" });
  if (finishMedia) {
    const medium = inferMediumFromMediaRef(finishMedia);
    if (medium === "image") {
      finishMediaImage = finishMedia;
      finishMediaAudio = "";
      finishMediaVideo = "";
    } else if (medium === "audio") {
      finishMediaImage = "";
      finishMediaAudio = finishMedia;
      finishMediaVideo = "";
    } else if (medium === "video") {
      finishMediaImage = "";
      finishMediaAudio = "";
      finishMediaVideo = finishMedia;
    }
  }
  return {
    finishMediaImage: normalizeMediaUrlRef(finishMediaImage),
    finishMediaAudio: normalizeMediaUrlRef(finishMediaAudio),
    finishMediaVideo: normalizeMediaUrlRef(finishMediaVideo)
  };
}

async function normalizeQuestionPayload(raw = {}) {
  const requestedType = normalizeQuestionType(raw.type);
  let type = requestedType;
  let allowMultiple = !!raw.allowMultiple;
  if (["media_identity", "image_identity", "audio_identity", "video_identity", "estimate"].includes(type)) allowMultiple = false;
  if (type === "order") allowMultiple = true;

  let promptImage = normalizeMediaUrlRef(raw.promptImage, { allowImageDataUrl: true });
  let promptAudio = normalizeMediaUrlRef(raw.promptAudio);
  let promptVideo = normalizeMediaUrlRef(raw.promptVideo);
  const promptMedia = normalizeMediaUrlRef(raw.promptMedia, { allowImageDataUrl: true });
  if (promptMedia) {
    const medium = inferMediumFromMediaRef(promptMedia);
    if (medium === "image") {
      promptImage = promptMedia;
      promptAudio = "";
      promptVideo = "";
    } else if (medium === "audio") {
      promptImage = "";
      promptAudio = promptMedia;
      promptVideo = "";
    } else if (medium === "video") {
      promptImage = "";
      promptAudio = "";
      promptVideo = promptMedia;
    }
  }
  if (promptImage.startsWith("data:image/")) {
    promptImage = await optimizeImageDataUrl(promptImage);
  }

  const inferredPromptType = promptVideo
    ? "video_identity"
    : promptAudio
      ? "audio_identity"
      : promptImage
        ? "image_identity"
        : "media_identity";

  if (type === "media_identity") {
    type = inferredPromptType;
  } else if (["image_identity", "audio_identity", "video_identity"].includes(type)) {
    const missingForSelected = (
      (type === "image_identity" && !promptImage) ||
      (type === "audio_identity" && !promptAudio) ||
      (type === "video_identity" && !promptVideo)
    );
    if (missingForSelected) type = inferredPromptType;
  }

  const estimateTargetNum = Number(raw.estimateTarget);
  const estimateToleranceNum = Number(raw.estimateTolerance ?? 0);
  const estimateTarget = Number.isFinite(estimateTargetNum) ? estimateTargetNum : null;
  const estimateTolerance = Number.isFinite(estimateToleranceNum) ? Math.max(0, estimateToleranceNum) : Number.NaN;

  const optionsRaw = Array.isArray(raw.options) ? raw.options : [];
  const options = optionsRaw
    .map((o, idx) => ({
      text: String(o?.text || "").trim().slice(0, 500),
      image: normalizeMediaUrlRef(o?.image, { allowImageDataUrl: true }),
      isCorrect: !!o?.isCorrect,
      orderIndex: Number.isFinite(Number(o?.orderIndex)) ? Number(o.orderIndex) : idx
    }))
    .filter(o => !!o.text || !!o.image);

  const normalizedOptions = type === "order"
    ? options.map((o, idx) => ({ ...o, isCorrect: false, orderIndex: idx }))
    : options;

  const solution = await normalizeQuestionSolution(raw);

  return {
    text: String(raw.text || "").trim(),
    type,
    allowMultiple,
    blockLabel: normalizeBlockLabel(raw.blockLabel),
    guestCorrectThresholdPercent: normalizeGuestThresholdPercent(raw.guestCorrectThresholdPercent),
    guestCorrectRule: normalizeGuestCorrectRule(raw.guestCorrectRule),
    promptImage,
    promptAudio,
    promptVideo,
    estimateTarget,
    estimateTolerance,
    options: normalizedOptions,
    solutionType: solution.solutionType,
    solutionText: solution.solutionText,
    solutionImage: normalizeMediaUrlRef(solution.solutionImage, { allowImageDataUrl: true }),
    solutionAudio: normalizeMediaUrlRef(solution.solutionAudio),
    solutionVideo: normalizeMediaUrlRef(solution.solutionVideo)
  };
}

function validateQuestionPayload(payload) {
  if (!payload.text) return "invalid_question";

  if (payload.type === "estimate") {
    if (!Number.isFinite(payload.estimateTarget)) return "invalid_estimate_target";
    if (!Number.isFinite(payload.estimateTolerance)) return "invalid_estimate_tolerance";
    return null;
  }

  if (payload.type === "media_identity") return "invalid_prompt_media";
  if (payload.type === "image_identity" && !payload.promptImage) return "invalid_prompt_image";
  if (payload.type === "audio_identity" && !payload.promptAudio) return "invalid_prompt_audio";
  if (payload.type === "video_identity" && !payload.promptVideo) return "invalid_prompt_video";

  if (payload.options.length < 2) return "invalid_question";
  if (payload.type === "order") return null;

  const correctCount = payload.options.filter(o => !!o.isCorrect).length;
  if (correctCount < 1) return "need_correct_option";
  if (!payload.allowMultiple && correctCount > 1) return "single_choice_needs_single_correct";
  return null;
}

function isPayloadTooLargeDbError(err) {
  const code = String(err?.original?.code || err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  return (
    code === "ER_NET_PACKET_TOO_LARGE" ||
    code === "ER_DATA_TOO_LONG" ||
    msg.includes("max_allowed_packet") ||
    msg.includes("packet") && msg.includes("large") ||
    msg.includes("data too long")
  );
}

async function reindexQuestionOrder(gameId) {
  const qs = await models.Question.findAll({
    where: { GameId: gameId },
    attributes: ["id", "sortOrder"],
    order: [["sortOrder", "ASC"], ["id", "ASC"]]
  });
  for (let i = 0; i < qs.length; i++) {
    if (Number(qs[i].sortOrder) === i) continue;
    await models.Question.update({ sortOrder: i }, { where: { id: qs[i].id } });
  }
}

/**
 * REST API
 */

// Master-Admin Login (tauscht statisches Secret gegen kurzlebige Session)
app.post("/api/admin/login", async (req, res) => {
  if (!ADMIN_TOKEN) return res.status(500).json({ error: "admin_token_not_configured" });
  const ip = clientIp(req);
  if (isLoginRateLimited(ip)) return res.status(429).json({ error: "too_many_attempts" });

  const secret = String(req.body?.secret || "");
  if (secret !== ADMIN_TOKEN) {
    markLoginFailure(ip);
    return res.status(403).json({ error: "forbidden" });
  }

  clearLoginFailures(ip);
  await cleanupExpiredAdminSessions();
  const { rawToken, session } = await createAdminSession(req);
  return res.json({
    ok: true,
    sessionToken: rawToken,
    expiresAt: session.expiresAt
  });
});

app.get("/api/admin/session", requireMasterAdmin, async (req, res) => {
  return res.json({ ok: true, expiresAt: req.adminSession.expiresAt });
});

app.post("/api/admin/logout", requireMasterAdmin, async (req, res) => {
  await req.adminSession.update({ revokedAt: new Date() });
  return res.json({ ok: true });
});

// Admin: Datei hochladen und als URL referenzieren
app.post("/api/admin/:token/media", requireToken, uploadMedia.single("file"), async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });

  const kind = mediaKindConfig(req.body?.kind);
  if (!kind) {
    await removeFileQuiet(req.file?.path);
    return res.status(400).json({ error: "invalid_media_kind" });
  }
  if (!req.file) return res.status(400).json({ error: "missing_file" });
  let effectiveKind = kind;
  if (kind.medium === "any") {
    const detected = detectMediumFromUpload(req.file);
    if (!detected) {
      await removeFileQuiet(req.file.path);
      return res.status(400).json({ error: "invalid_media_type" });
    }
    effectiveKind = {
      ...kind,
      medium: detected,
      kind: `${kind.group}_${detected}`
    };
  } else if (!mimeMatchesMedium(req.file.mimetype, kind.medium) && !filenameLooksLikeMedium(req.file.originalname, kind.medium)) {
    await removeFileQuiet(req.file.path);
    return res.status(400).json({ error: "invalid_media_type" });
  }

  try {
    const stored = await storeUploadedMedia({
      file: req.file,
      gameId: req.game.id,
      kindConfig: effectiveKind
    });
    return res.json({
      ok: true,
      url: stored.urlPath,
      optimized: stored.optimized,
      medium: effectiveKind.medium
    });
  } catch (err) {
    await removeFileQuiet(req.file?.path);
    logCompactError("media upload failed", err);
    return res.status(500).json({ error: "upload_failed" });
  }
});

// Spiel erstellen (inkl. Player in DB)
app.post("/api/games", requireMasterAdmin, async (req, res) => {

  const title = normalizeGameTitle(req.body?.title, "Quiz");
  const playerName = (req.body?.playerName || "").trim().slice(0, 80) || "Player";
  const uiLanguage = normalizeUiLanguage(req.body?.uiLanguage || "en");

  const { game, links, player } = await createGame(models, { title, playerName, uiLanguage });
  const urls = publicLinks(publicBaseUrlFor(req), links);

  res.json({
    game: {
      id: game.id,
      title: game.title,
      playerId: player.id,
      playerName: player.nickname,
      uiLanguage: normalizeUiLanguage(game.uiLanguage || "en")
    },
    tokens: Object.fromEntries(Object.entries(links).map(([k,v]) => [k, v.token])),
    urls
  });
});

// QR Code als PNG
app.get("/api/qr.png", async (req, res) => {
  const targetUrl = String(req.query?.u || req.query?.url || "").trim();
  if (!targetUrl) return res.status(400).json({ error: "missing_url" });
  if (targetUrl.length > 4000) return res.status(400).json({ error: "url_too_long" });

  const png = await QRCode.toBuffer(targetUrl, { type: "png", width: 512, margin: 2 });
  res.setHeader("Content-Type", "image/png");
  res.send(png);
});

app.get("/api/qr/:token.png", async (req, res) => {
  const token = req.params.token;
  const url = `${publicBaseUrlFor(req)}/#/t/${token}`;
  const png = await QRCode.toBuffer(url, { type: "png", width: 512, margin: 2 });
  res.setHeader("Content-Type", "image/png");
  res.send(png);
});

app.get("/api/i18n/languages", async (_req, res) => {
  const languages = await getAvailableLanguages();
  return res.json({ sourceLanguage: "en", languages });
});

app.get("/api/i18n/:pair.csv", async (req, res) => {
  const filePath = translationFilePathFromPair(req.params.pair);
  if (!filePath) return res.status(404).json({ error: "not_found" });
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.send(raw);
  } catch {
    return res.status(404).json({ error: "not_found" });
  }
});

// Spielstate nach Token
app.get("/api/state/:token", requireToken, async (req, res) => {
  const full = await loadGameFull(models, req.game.id);
  const score = await computeScore(models, req.game.id, { uptoIndex: req.game.revealedQuestionIndex });

  let links = null;
  let urls = null;
  if (req.link.type === "admin") {
    const allLinks = await models.Link.findAll({ where: { GameId: req.game.id } });
    links = Object.fromEntries(allLinks.map(l => [l.type, l.token]));
    if (!links.results) {
      const resultLink = await ensureResultsLink(req.game.id);
      links.results = resultLink.token;
    }
    urls = publicLinks(publicBaseUrlFor(req), {
      admin: { token: links.admin },
      present: { token: links.present },
      guest_live: { token: links.guest_live },
      guest_async: { token: links.guest_async },
      player: { token: links.player },
      results: { token: links.results }
    });
  }

  res.json({
    linkType: req.link.type,
    game: {
      ...req.game.toJSON(),
      uiLanguage: normalizeUiLanguage(req.game.uiLanguage || "en"),
      guestCount: await models.Participant.count({ where: { GameId: req.game.id, kind: "guest" } })
    },
    player: full?.Player ? { id: full.Player.id, nickname: full.Player.nickname } : null,
    questions: full?.Questions || [],
    score,
    links,
    urls
  });
});

// Admin: Gewinner-Texte speichern
app.post("/api/admin/:token/wintexts", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const guestWinText = String(req.body?.guestWinText || "");
  const playerWinText = String(req.body?.playerWinText || "");
  const tieWinText = String(req.body?.tieWinText || "");

  await models.Game.update({ guestWinText, playerWinText, tieWinText }, { where: { id: req.game.id } });
  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Admin: Quiz-Titel ändern
app.post("/api/admin/:token/title", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const title = normalizeGameTitle(req.body?.title, "");
  if (!title) return res.status(400).json({ error: "invalid_title" });
  await models.Game.update({ title }, { where: { id: req.game.id } });
  await emitGameState(req.game.id);
  return res.json({ ok: true });
});

// Admin: Abschluss-Medium für Ergebnisseite speichern
app.post("/api/admin/:token/finish-media", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const media = normalizeFinishMediaPayload(req.body || {});
  await models.Game.update(media, { where: { id: req.game.id } });
  await cleanupOrphanMediaForGame(req.game.id);
  await emitGameState(req.game.id);
  return res.json({ ok: true });
});

// Startseite: veröffentlichte Spiele auflisten (inkl. Präsentations-Token)
app.get("/api/public/games", async (req, res) => {
  const games = await models.Game.findAll({
    where: { isPublished: true },
    order: [["updatedAt", "DESC"]]
  });

  const gameIds = games.map(g => g.id);
  const links = await models.Link.findAll({ where: { GameId: gameIds, type: "present" } });
  const presentByGame = new Map(links.map(l => [l.GameId, l.token]));

  res.json({
    games: games.map(g => ({
      id: g.id,
      title: g.title,
      status: g.status,
      uiLanguage: normalizeUiLanguage(g.uiLanguage || "en"),
      presentToken: presentByGame.get(g.id) || null
    })).filter(x => !!x.presentToken)
  });
});

// Öffentliches Ergebnis (sharebarer Link)
// Sharebare Ergebnis-Grafik (PNG)
app.get("/api/public/results/:token([A-Za-z0-9_-]+).png", requireToken, async (req, res) => {
  if (req.link.type !== "results") return res.status(403).json({ error: "forbidden" });
  const participantId = Number(req.query?.p || 0);
  const payload = await buildResultsPayloadWithPersonal(req.game.id, {
    participantId
  });
  if (!payload) return res.status(404).json({ error: "not_found" });

  const sharp = await getSharpLib();
  if (!sharp) return res.status(503).json({ error: "image_renderer_unavailable" });

  try {
    const svg = buildResultsSvg(payload);
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.send(png);
  } catch (err) {
    return res.status(500).json({ error: "share_image_failed", detail: err?.message || String(err) });
  }
});

app.delete("/api/admin/:token", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const gameId = req.game.id;
  clearAutoRevealTimer(gameId);
  try {
    const deleted = await deleteGameWithDependencies(gameId);
    if (!deleted) return res.status(404).json({ error: "game_not_found" });
    io.to(gameRoom(gameId)).emit("game_deleted", { gameId });
    return res.json({ ok: true });
  } catch (err) {
    logCompactError("delete game by admin token failed", err);
    return res.status(500).json({ error: "delete_game_failed" });
  }
});

app.get("/api/public/results/:token([A-Za-z0-9_-]+)", requireToken, async (req, res) => {
  if (req.link.type !== "results") return res.status(403).json({ error: "forbidden" });
  const participantId = Number(req.query?.p || 0);
  const payload = await buildResultsPayloadWithPersonal(req.game.id, {
    participantId
  });
  if (!payload) return res.status(404).json({ error: "not_found" });
  return res.json({
    ...payload,
    share: {
      token: req.link.token,
      imagePath: `/api/public/results/${req.link.token}.png`,
      personalParticipantId: payload?.personal?.participantId || null
    }
  });
});

// Gast: persönlicher Ergebnis-Link + PNG abrufen
app.get("/api/guest/:token/personal-share", requireToken, async (req, res) => {
  if (!["guest_live", "guest_async"].includes(String(req.link.type || ""))) return res.status(403).json({ error: "forbidden" });
  if (req.game?.showTopPlayers === false) return res.status(403).json({ error: "personal_share_disabled" });

  const participantId = Number(req.query?.participantId || 0);
  if (!Number.isFinite(participantId) || participantId <= 0) return res.status(400).json({ error: "invalid_participant" });

  const participant = await models.Participant.findByPk(participantId);
  if (!participant || participant.GameId !== req.game.id || participant.kind !== "guest") {
    return res.status(404).json({ error: "participant_not_found" });
  }

  const resultLink = await ensureResultsLink(req.game.id);
  return res.json({
    ok: true,
    participantId,
    resultToken: resultLink.token,
    imagePath: `/api/public/results/${resultLink.token}.png?p=${participantId}`
  });
});

// Master-Admin: Spieleübersicht (zum Auswählen eines Spiels im Admin)
app.get("/api/admin/master/games", requireMasterAdmin, async (req, res) => {
  const games = await models.Game.findAll({ order: [["updatedAt", "DESC"]] });
  const links = await models.Link.findAll({
    where: { GameId: games.map(g => g.id) },
    order: [["id", "ASC"]]
  });
  const byGame = new Map();
  for (const l of links) {
    if (!byGame.has(l.GameId)) byGame.set(l.GameId, {});
    byGame.get(l.GameId)[l.type] = l.token;
  }
  for (const g of games) {
    const row = byGame.get(g.id) || {};
    if (!row.results) {
      const resultLink = await ensureResultsLink(g.id);
      row.results = resultLink.token;
    }
    byGame.set(g.id, row);
  }

  res.json({
    games: games.map(g => ({
      id: g.id,
      title: g.title,
      status: g.status,
      isPublished: g.isPublished,
      uiLanguage: normalizeUiLanguage(g.uiLanguage || "en"),
      updatedAt: g.updatedAt,
      tokens: byGame.get(g.id) || {}
    }))
  });
});

app.get("/api/admin/master/games/:gameId/export", requireMasterAdmin, async (req, res) => {
  const gameId = Number(req.params.gameId || 0);
  if (!Number.isFinite(gameId) || gameId <= 0) return res.status(400).json({ error: "invalid_game_id" });
  const payload = await exportFullGamePayload(gameId);
  if (!payload) return res.status(404).json({ error: "game_not_found" });
  const ts = new Date().toISOString().slice(0, 10);
  const safeName = normalizePackageName(payload?.game?.title || "quizduell")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "quizduell";
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}_full_${ts}.json"`);
  return res.send(raw);
});

app.post("/api/admin/master/games/import", requireMasterAdmin, uploadMedia.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "missing_file" });
  let createdGameId = null;
  try {
    const raw = await fsp.readFile(req.file.path, "utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }

    const meta = parseImportedFullGamePayload(parsed);
    const { game, links } = await createGame(models, {
      title: meta.title,
      playerName: meta.playerName,
      uiLanguage: meta.uiLanguage
    });
    createdGameId = game.id;

    const finishMedia = await normalizeImportedFinishMedia({
      finishMediaImage: meta.finishMediaImage,
      finishMediaAudio: meta.finishMediaAudio,
      finishMediaVideo: meta.finishMediaVideo
    }, game.id);

    await models.Game.update({
      isPublished: !!meta.isPublished,
      showScore: !!meta.showScore,
      showQuizTitle: !!meta.showQuizTitle,
      showParticipantMedia: !!meta.showParticipantMedia,
      showTopPlayers: !!meta.showTopPlayers,
      autoRevealEnabled: !!meta.autoRevealEnabled,
      autoRevealDelaySeconds: normalizeAutoRevealDelaySeconds(meta.autoRevealDelaySeconds),
      guestWinText: meta.guestWinText,
      playerWinText: meta.playerWinText,
      tieWinText: meta.tieWinText,
      ...finishMedia
    }, { where: { id: game.id } });

    const normalizedQuestions = await normalizePackageQuestionsForInsert(meta.questions, game.id);
    if (normalizedQuestions.length > 0) {
      await insertQuestionsIntoGame(game.id, normalizedQuestions, { mode: "replace" });
    } else {
      await emitGameState(game.id);
    }

    const urls = publicLinks(publicBaseUrlFor(req), links);
    return res.json({
      ok: true,
      imported: normalizedQuestions.length,
      game: {
        id: game.id,
        title: meta.title,
        uiLanguage: meta.uiLanguage
      },
      tokens: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.token])),
      urls
    });
  } catch (err) {
    if (createdGameId) {
      clearAutoRevealTimer(createdGameId);
      await deleteGameWithDependencies(createdGameId).catch(() => {});
    }
    return res.status(400).json({ error: String(err?.message || "invalid_import") });
  } finally {
    await removeFileQuiet(req.file?.path);
  }
});

app.delete("/api/admin/master/games/:gameId", requireMasterAdmin, async (req, res) => {
  const gameId = Number(req.params.gameId || 0);
  if (!Number.isFinite(gameId) || gameId <= 0) return res.status(400).json({ error: "invalid_game_id" });
  clearAutoRevealTimer(gameId);
  try {
    const deleted = await deleteGameWithDependencies(gameId);
    if (!deleted) return res.status(404).json({ error: "game_not_found" });
    io.to(gameRoom(gameId)).emit("game_deleted", { gameId });
    return res.json({ ok: true });
  } catch (err) {
    logCompactError("delete game by master admin failed", err);
    return res.status(500).json({ error: "delete_game_failed" });
  }
});

app.get("/api/admin/:token/full-export", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const payload = await exportFullGamePayload(req.game.id);
  if (!payload) return res.status(404).json({ error: "game_not_found" });
  const ts = new Date().toISOString().slice(0, 10);
  const safeName = normalizePackageName(payload?.game?.title || "quizduell")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "quizduell";
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}_full_${ts}.json"`);
  return res.send(raw);
});

app.post("/api/admin/:token/full-import", requireToken, uploadMedia.single("file"), async (req, res) => {
  if (req.link.type !== "admin") {
    await removeFileQuiet(req.file?.path);
    return res.status(403).json({ error: "forbidden" });
  }
  if (req.game.status === "live") {
    await removeFileQuiet(req.file?.path);
    return res.status(409).json({ error: "game_live" });
  }
  if (!req.file) return res.status(400).json({ error: "missing_file" });
  try {
    const raw = await fsp.readFile(req.file.path, "utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }

    const meta = parseImportedFullGamePayload(parsed);
    const finishMedia = await normalizeImportedFinishMedia({
      finishMediaImage: meta.finishMediaImage,
      finishMediaAudio: meta.finishMediaAudio,
      finishMediaVideo: meta.finishMediaVideo
    }, req.game.id);
    const game = await models.Game.findByPk(req.game.id);
    if (!game) return res.status(404).json({ error: "game_not_found" });
    await models.Game.update({
      title: meta.title,
      uiLanguage: meta.uiLanguage,
      isPublished: !!meta.isPublished,
      showScore: !!meta.showScore,
      showQuizTitle: !!meta.showQuizTitle,
      showParticipantMedia: !!meta.showParticipantMedia,
      showTopPlayers: !!meta.showTopPlayers,
      autoRevealEnabled: !!meta.autoRevealEnabled,
      autoRevealDelaySeconds: normalizeAutoRevealDelaySeconds(meta.autoRevealDelaySeconds),
      guestWinText: meta.guestWinText,
      playerWinText: meta.playerWinText,
      tieWinText: meta.tieWinText,
      ...finishMedia
    }, { where: { id: req.game.id } });
    await models.Participant.update({
      nickname: meta.playerName
    }, { where: { id: game.PlayerId } });
    clearAutoRevealTimer(req.game.id);
    const normalizedQuestions = await normalizePackageQuestionsForInsert(meta.questions, req.game.id);
    await insertQuestionsIntoGame(req.game.id, normalizedQuestions, { mode: "replace" });
    return res.json({ ok: true, imported: normalizedQuestions.length });
  } catch (err) {
    return res.status(400).json({ error: String(err?.message || "invalid_import") });
  } finally {
    await removeFileQuiet(req.file?.path);
  }
});

// Admin: Fragepakete auflisten (eingebaute Vorlagen + eigene Pakete)
app.get("/api/admin/:token/question-packages", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const custom = await listCustomPackages();
  const builtins = BUILTIN_QUESTION_PACKAGES.map(pkg => packageListEntry(normalizePackagePayload(pkg, pkg.name)));
  const customEntries = custom.map(packageListEntry);
  return res.json({ packages: [...builtins, ...customEntries] });
});

// Admin: Aus aktuellen Fragen ein eigenes Paket erzeugen
app.post("/api/admin/:token/question-packages/save", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const questions = await exportQuestionsForGame(req.game.id);
  if (!questions.length) return res.status(400).json({ error: "no_questions" });

  const title = normalizePackageName(req.body?.name, `${req.game.title || "Quiz"} package`);
  const description = normalizePackageDescription(req.body?.description || "");
  const saved = await saveCustomPackage({
    name: title,
    description,
    questions,
    kind: "custom",
    version: QUESTION_PACKAGE_VERSION
  });
  return res.json({ ok: true, package: packageListEntry(saved) });
});

// Admin: Vorlagen-/Paket-Fragen in ein Spiel laden
app.post("/api/admin/:token/question-packages/apply", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  if (req.game.status === "live") return res.status(409).json({ error: "game_live" });

  const packageId = String(req.body?.packageId || "").trim();
  if (!packageId) return res.status(400).json({ error: "missing_package_id" });
  const mode = req.body?.mode === "append" ? "append" : "replace";

  const pkg = await loadQuestionPackageById(packageId);
  if (!pkg) return res.status(404).json({ error: "package_not_found" });

  try {
    const normalizedQuestions = await normalizePackageQuestionsForInsert(pkg.questions, req.game.id);
    if (!normalizedQuestions.length) return res.status(400).json({ error: "no_questions" });
    await insertQuestionsIntoGame(req.game.id, normalizedQuestions, { mode });
    return res.json({ ok: true, imported: normalizedQuestions.length, package: packageListEntry(pkg) });
  } catch (err) {
    return res.status(400).json({ error: String(err?.message || "invalid_package") });
  }
});

// Admin: Fragen exportieren (JSON/CSV, inkl. eingebetteter Medien)
app.get("/api/admin/:token/question-packages/export", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const format = String(req.query?.format || "json").trim().toLowerCase() === "csv" ? "csv" : "json";

  const questions = await exportQuestionsForGame(req.game.id);
  const packagePayload = normalizePackagePayload({
    version: QUESTION_PACKAGE_VERSION,
    kind: "export",
    name: normalizePackageName(req.game.title, "Quiz Duel"),
    description: `Export aus Spiel #${req.game.id}`,
    questions
  }, normalizePackageName(req.game.title, "Quiz Duel"));
  packagePayload.format = "quizduell.question_package";

  const ts = new Date().toISOString().slice(0, 10);
  const safeName = normalizePackageName(req.game.title, "quizduell")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "quizduell";

  if (format === "csv") {
    const csv = buildQuestionsCsv(packagePayload.questions);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_${ts}.csv"`);
    return res.send(csv);
  }

  const raw = `${JSON.stringify(packagePayload, null, 2)}\n`;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}_${ts}.json"`);
  return res.send(raw);
});

// Admin: Fragen importieren (JSON/CSV-Datei; data:-Medien werden als /media persistiert)
app.post("/api/admin/:token/question-packages/import", requireToken, uploadMedia.single("file"), async (req, res) => {
  if (req.link.type !== "admin") {
    await removeFileQuiet(req.file?.path);
    return res.status(403).json({ error: "forbidden" });
  }
  if (req.game.status === "live") {
    await removeFileQuiet(req.file?.path);
    return res.status(409).json({ error: "game_live" });
  }
  if (!req.file) return res.status(400).json({ error: "missing_file" });

  const mode = req.body?.mode === "append" ? "append" : "replace";
  let requestedFormat = String(req.body?.format || "").trim().toLowerCase();
  if (!requestedFormat) {
    const lowerName = String(req.file.originalname || "").toLowerCase();
    if (lowerName.endsWith(".csv")) requestedFormat = "csv";
    else requestedFormat = "json";
  }

  try {
    const raw = await fsp.readFile(req.file.path, "utf8");
    let pkg = null;

    if (requestedFormat === "csv") {
      const questions = parseQuestionsCsv(raw);
      pkg = normalizePackagePayload({
        name: String(req.body?.name || "CSV import"),
        description: "Aus CSV importiert",
        questions
      }, "CSV import");
    } else {
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: "invalid_json" });
      }
      pkg = normalizePackagePayload(parsed, "JSON import");
    }

    const normalizedQuestions = await normalizePackageQuestionsForInsert(pkg.questions, req.game.id);
    if (!normalizedQuestions.length) return res.status(400).json({ error: "no_questions" });

    await insertQuestionsIntoGame(req.game.id, normalizedQuestions, { mode });

    let savedPackage = null;
    const saveAsTemplate = String(req.body?.saveAsTemplate || "").trim();
    if (saveAsTemplate) {
      const packageQuestions = [];
      for (const q of normalizedQuestions) {
        packageQuestions.push(await normalizedPayloadToPackageQuestion(q));
      }
      savedPackage = await saveCustomPackage({
        name: normalizePackageName(saveAsTemplate),
        description: normalizePackageDescription(req.body?.saveDescription || pkg.description || ""),
        questions: packageQuestions,
        kind: "custom",
        version: QUESTION_PACKAGE_VERSION
      });
    }

    return res.json({
      ok: true,
      imported: normalizedQuestions.length,
      savedTemplate: savedPackage ? packageListEntry(savedPackage) : null
    });
  } catch (err) {
    return res.status(400).json({ error: String(err?.message || "invalid_import") });
  } finally {
    await removeFileQuiet(req.file?.path);
  }
});

// Admin: Frage hinzufügen
app.post("/api/admin/:token/questions", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  try {
    const payload = await normalizeQuestionPayload(req.body || {});
    const validationError = validateQuestionPayload(payload);
    if (validationError) return res.status(400).json({ error: validationError });

    const maxSortOrder = await models.Question.max("sortOrder", { where: { GameId: req.game.id } });
    const nextSortOrder = Number.isFinite(Number(maxSortOrder)) ? Number(maxSortOrder) + 1 : 0;

    const q = await models.Question.create({
      GameId: req.game.id,
      text: payload.text,
      type: payload.type,
      allowMultiple: payload.allowMultiple,
      sortOrder: nextSortOrder,
      blockLabel: payload.blockLabel,
      promptImage: payload.promptImage,
      promptAudio: payload.promptAudio,
      promptVideo: payload.promptVideo,
      guestCorrectThresholdPercent: normalizeGuestThresholdPercent(payload.guestCorrectThresholdPercent),
      guestCorrectRule: normalizeGuestCorrectRule(payload.guestCorrectRule),
      estimateTarget: payload.type === "estimate" ? payload.estimateTarget : null,
      estimateTolerance: payload.type === "estimate" ? payload.estimateTolerance : 0,
      solutionType: payload.solutionType,
      solutionText: payload.solutionText,
      solutionImage: payload.solutionImage,
      solutionAudio: payload.solutionAudio,
      solutionVideo: payload.solutionVideo
    });
    for (const opt of payload.options) {
      await models.Option.create({
        QuestionId: q.id,
        text: opt.text,
        image: opt.image || "",
        isCorrect: !!opt.isCorrect,
        orderIndex: Number(opt.orderIndex || 0)
      });
    }

    await emitGameState(req.game.id);
    await cleanupOrphanMediaForGame(req.game.id);
    return res.json({ ok: true });
  } catch (err) {
    if (isPayloadTooLargeDbError(err)) {
      return res.status(413).json({ error: "payload_too_large" });
    }
    logCompactError("create question failed", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// Admin: Frage bearbeiten
app.put("/api/admin/:token/questions/:questionId", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  try {
    const questionId = Number(req.params.questionId);
    const q = await models.Question.findByPk(questionId, { include: [models.Option] });
    if (!q || q.GameId !== req.game.id) return res.status(404).json({ error: "not_found" });

    const payload = await normalizeQuestionPayload(req.body || {});
    const validationError = validateQuestionPayload(payload);
    if (validationError) return res.status(400).json({ error: validationError });

    await q.update({
      text: payload.text,
      type: payload.type,
      allowMultiple: payload.allowMultiple,
      blockLabel: payload.blockLabel,
      promptImage: payload.promptImage,
      promptAudio: payload.promptAudio,
      promptVideo: payload.promptVideo,
      guestCorrectThresholdPercent: normalizeGuestThresholdPercent(payload.guestCorrectThresholdPercent),
      guestCorrectRule: normalizeGuestCorrectRule(payload.guestCorrectRule),
      estimateTarget: payload.type === "estimate" ? payload.estimateTarget : null,
      estimateTolerance: payload.type === "estimate" ? payload.estimateTolerance : 0,
      solutionType: payload.solutionType,
      solutionText: payload.solutionText,
      solutionImage: payload.solutionImage,
      solutionAudio: payload.solutionAudio,
      solutionVideo: payload.solutionVideo
    });
    // Optionen ersetzen (einfach & robust)
    await models.Option.destroy({ where: { QuestionId: q.id } });
    for (const opt of payload.options) {
      await models.Option.create({
        QuestionId: q.id,
        text: opt.text,
        image: opt.image || "",
        isCorrect: !!opt.isCorrect,
        orderIndex: Number(opt.orderIndex || 0)
      });
    }

    await emitGameState(req.game.id);
    await cleanupOrphanMediaForGame(req.game.id);
    return res.json({ ok: true });
  } catch (err) {
    if (isPayloadTooLargeDbError(err)) {
      return res.status(413).json({ error: "payload_too_large" });
    }
    logCompactError("update question failed", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// Admin: Fragen-Reihenfolge und Blöcke speichern
app.post("/api/admin/:token/questions/reorder", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  if (req.game.status === "live") return res.status(409).json({ error: "game_live" });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const questions = await models.Question.findAll({
    where: { GameId: req.game.id },
    attributes: ["id", "blockLabel"],
    order: [["sortOrder", "ASC"], ["id", "ASC"]]
  });

  if (!questions.length && !items.length) return res.json({ ok: true });
  if (items.length !== questions.length) return res.status(400).json({ error: "invalid_reorder_payload" });

  const existingById = new Map(questions.map(q => [q.id, q]));
  const seen = new Set();

  for (let idx = 0; idx < items.length; idx++) {
    const id = Number(items[idx]?.id);
    if (!id || !existingById.has(id) || seen.has(id)) {
      return res.status(400).json({ error: "invalid_reorder_payload" });
    }
    seen.add(id);
    const previousBlock = existingById.get(id)?.blockLabel || "General";
    const blockLabel = normalizeBlockLabel(items[idx]?.blockLabel || previousBlock);
    await models.Question.update({ sortOrder: idx, blockLabel }, { where: { id } });
  }

  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Admin: Frage löschen
app.delete("/api/admin/:token/questions/:questionId", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const questionId = Number(req.params.questionId);
  const q = await models.Question.findByPk(questionId);
  if (!q || q.GameId !== req.game.id) return res.status(404).json({ error: "not_found" });
  await q.destroy();
  await reindexQuestionOrder(req.game.id);

  // Wenn die aktuelle Frage außerhalb liegt: Index clampen
  const full = await loadGameFull(models, req.game.id);
  const total = full?.Questions?.length || 0;
  const game = await models.Game.findByPk(req.game.id);
  const maxIndex = total - 1;
  const newCurrent = total > 0 ? Math.min(game.currentQuestionIndex, maxIndex) : 0;
  const newRevealed = total > 0 ? Math.min(game.revealedQuestionIndex, maxIndex) : -1;
  await game.update({ currentQuestionIndex: newCurrent, revealedQuestionIndex: newRevealed });

  await emitGameState(req.game.id);
  await cleanupOrphanMediaForGame(req.game.id);
  res.json({ ok: true });
});

// Admin: Spielername ändern (Player ist fest am Spiel)
app.post("/api/admin/:token/player", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const name = (req.body?.playerName || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "invalid_name" });

  const game = await models.Game.findByPk(req.game.id);
  await models.Participant.update({ nickname: name }, { where: { id: game.PlayerId } });

  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Admin: Start / Neustart
app.post("/api/admin/:token/start", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });

  const game = await models.Game.findByPk(req.game.id);
  clearAutoRevealTimer(req.game.id);
  
  await models.Game.update(
    { 
      status: "live", 
      currentQuestionIndex: 0, 
      phase: "answering", 
      revealedQuestionIndex: -1,
      winner: null,
      lastStartedAt: new Date()
    },
    { where: { id: req.game.id } }
  );
  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Admin: Spiel beenden (zurück auf Setup)
app.post("/api/admin/:token/stop", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });

  const game = await models.Game.findByPk(req.game.id);
  const fullInfo = await loadGameFull(models, req.game.id);
  clearAutoRevealTimer(req.game.id);

  // Live-Gäste entfernen (alle Gäste sind in diesem Kontext Live-Gäste, Async nutzt andere Endpunkte/Logik falls vorhanden, 
  // aber hier löschen wir einfach alle Teilnehmer außer dem Player)
  await models.Participant.destroy({ where: { GameId: game.id, kind: "guest" } });

  // Player-Antworten zurücksetzen
  const qIds = (fullInfo?.Questions || []).map(q => q.id);
  if (qIds.length) {
    // Vollständiger Reset: alle Antworten des Spiels entfernen
    await models.Answer.destroy({ where: { QuestionId: qIds } });
  }

  // Spiel auf Setup zurücksetzen und Clients zum "frischen" Zustand zwingen
  await models.Game.update(
    {
      status: "setup",
      currentQuestionIndex: 0,
      phase: "answering",
      revealedQuestionIndex: -1,
      winner: null,
      // Wird in den Guest-Clients als Kick/Reset-Signal verwendet
      lastStartedAt: new Date()
    },
    { where: { id: req.game.id } }
  );
  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Admin: Spiel veröffentlichen (Startseite)
app.post("/api/admin/:token/publish", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const isPublished = !!req.body?.isPublished;
  const showScore = req.body?.showScore !== undefined ? !!req.body.showScore : undefined;
  const showQuizTitle = req.body?.showQuizTitle !== undefined ? !!req.body.showQuizTitle : undefined;
  const showParticipantMedia = req.body?.showParticipantMedia !== undefined ? !!req.body.showParticipantMedia : undefined;
  const showTopPlayers = req.body?.showTopPlayers !== undefined ? !!req.body.showTopPlayers : undefined;
  const uiLanguage = req.body?.uiLanguage !== undefined
    ? normalizeUiLanguage(req.body?.uiLanguage)
    : undefined;
  const autoRevealEnabled = req.body?.autoRevealEnabled !== undefined
    ? !!req.body.autoRevealEnabled
    : undefined;
  const autoRevealDelaySeconds = req.body?.autoRevealDelaySeconds !== undefined
    ? normalizeAutoRevealDelaySeconds(req.body?.autoRevealDelaySeconds)
    : undefined;
  
  const update = { isPublished };
  if (showScore !== undefined) update.showScore = showScore;
  if (showQuizTitle !== undefined) update.showQuizTitle = showQuizTitle;
  if (showParticipantMedia !== undefined) update.showParticipantMedia = showParticipantMedia;
  if (showTopPlayers !== undefined) update.showTopPlayers = showTopPlayers;
  if (uiLanguage !== undefined) update.uiLanguage = uiLanguage;
  if (autoRevealEnabled !== undefined) update.autoRevealEnabled = autoRevealEnabled;
  if (autoRevealDelaySeconds !== undefined) update.autoRevealDelaySeconds = autoRevealDelaySeconds;

  const previousAutoRevealEnabled = req.game.autoRevealEnabled !== false;
  const previousAutoRevealDelaySeconds = normalizeAutoRevealDelaySeconds(req.game.autoRevealDelaySeconds);
  const nextAutoRevealEnabled = autoRevealEnabled !== undefined ? autoRevealEnabled : previousAutoRevealEnabled;
  const nextAutoRevealDelaySeconds = autoRevealDelaySeconds !== undefined ? autoRevealDelaySeconds : previousAutoRevealDelaySeconds;
  const autoRevealSettingsChanged = previousAutoRevealEnabled !== nextAutoRevealEnabled
    || previousAutoRevealDelaySeconds !== nextAutoRevealDelaySeconds;
  if (autoRevealSettingsChanged) {
    clearAutoRevealTimer(req.game.id);
  }

  await models.Game.update(update, { where: { id: req.game.id } });
  if (nextAutoRevealEnabled) {
    await scheduleAutoRevealIfReady(req.game.id);
  }
  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Admin: Reset/Neustart (nur hier) – setzt Fortschritt zurück und löscht optional Antworten
app.post("/api/admin/:token/reset", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const clearAnswers = req.body?.clearAnswers !== false;
  clearAutoRevealTimer(req.game.id);

  const full = await loadGameFull(models, req.game.id);
  if (clearAnswers) {
    const qIds = (full?.Questions || []).map(q => q.id);
    if (qIds.length) await models.Answer.destroy({ where: { QuestionId: qIds } });
  }
  await models.Game.update(
    { status: "setup", currentQuestionIndex: 0, phase: "answering", revealedQuestionIndex: -1 },
    { where: { id: req.game.id } }
  );
  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Präsentation: sharebare Ergebnis-Links abrufen
app.get("/api/present/:token/share", requireToken, async (req, res) => {
  if (req.link.type !== "present" && req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  const resultLink = await ensureResultsLink(req.game.id);
  return res.json({
    token: resultLink.token,
    imagePath: `/api/public/results/${resultLink.token}.png`
  });
});

// Präsentation: Reveal / Next
app.post("/api/present/:token/reveal", requireToken, async (req, res) => {
  if (req.link.type !== "present") return res.status(403).json({ error: "forbidden" });
  clearAutoRevealTimer(req.game.id);
  const game = await models.Game.findByPk(req.game.id);
  if (game.status !== "live") return res.status(400).json({ error: "not_live" });
  await models.Game.update(
    { phase: "revealed", revealedQuestionIndex: game.currentQuestionIndex },
    { where: { id: req.game.id } }
  );
  await emitGameState(req.game.id);
  res.json({ ok: true });
});

app.post("/api/present/:token/next", requireToken, async (req, res) => {
  if (req.link.type !== "present") return res.status(403).json({ error: "forbidden" });
  clearAutoRevealTimer(req.game.id);

  const game = await models.Game.findByPk(req.game.id);
  if (game.status !== "live") return res.status(400).json({ error: "not_live" });

  const full = await loadGameFull(models, req.game.id);
  const total = full?.Questions?.length || 0;

  const nextIndex = game.currentQuestionIndex + 1;

  if (nextIndex >= total) {
    // Gewinner bestimmen (Score bis zuletzt revealed)
    const finalGame = await models.Game.findByPk(req.game.id);
    const finalScore = await computeScore(models, req.game.id, { uptoIndex: finalGame.revealedQuestionIndex });
    let winner = "tie";
    if (finalScore.player > finalScore.guests) winner = "player";
    else if (finalScore.guests > finalScore.player) winner = "guests";

    await models.Game.update({ status: "finished", phase: "revealed", winner }, { where: { id: req.game.id } });
  } else {
    await models.Game.update({ currentQuestionIndex: nextIndex, phase: "answering" }, { where: { id: req.game.id } });
  }

  await emitGameState(req.game.id);
  res.json({ ok: true });
});

// Teilnehmer registrieren (nur Gäste; Player ist fix im Spiel)
app.post("/api/join/:token", requireToken, async (req, res) => {
  const nickname = String(req.body?.nickname || "").trim().slice(0, 80);
  const clientKey = String(req.body?.clientKey || "").trim().slice(0, 80) || null;

  if (req.link.type === "guest_live" || req.link.type === "guest_async") {
    // Falls eine participantId übergeben wird, versuchen wir diesen Participant zu finden
    const existingId = Number(req.body?.participantId);
    if (existingId) {
      const p = await models.Participant.findOne({ where: { id: existingId, GameId: req.game.id, kind: "guest" } });
      if (p) {
        if (p.clientKey && clientKey && p.clientKey !== clientKey) {
          return res.status(409).json({ error: "participant_in_use" });
        }
        if (!p.clientKey && clientKey) await p.update({ clientKey });
        if (nickname && nickname !== p.nickname) await p.update({ nickname });
        scheduleEmitGameState(req.game.id);
        return res.json({ participantId: p.id, kind: "guest", nickname: p.nickname });
      }
      return res.status(404).json({ error: "participant_not_found" });
    }

    if (!nickname) return res.status(400).json({ error: "invalid_name" });
    const p = await models.Participant.create({ GameId: req.game.id, kind: "guest", nickname, clientKey });
    scheduleEmitGameState(req.game.id);
    return res.json({ participantId: p.id, kind: "guest", nickname: p.nickname });
  }

  if (req.link.type === "player") {
    const game = await models.Game.findByPk(req.game.id);
    const player = await models.Participant.findByPk(game.PlayerId);
    // Optional: wenn per Player-Link ein Name übergeben wird, kann der Spieler umbenannt werden
    if (nickname && nickname !== player.nickname) {
      await player.update({ nickname });
    }
    scheduleEmitGameState(req.game.id);
    return res.json({ participantId: player.id, kind: "player", nickname: player.nickname });
  }

  return res.status(400).json({ error: "invalid_join" });
});

// Antwort speichern (Gäste/Player je nach Token)
app.post("/api/answer/:token", requireToken, async (req, res) => {
  if (!["guest_live", "guest_async", "player"].includes(req.link.type)) return res.status(403).json({ error: "forbidden" });

  const participantId = Number(req.body?.participantId);
  const questionId = Number(req.body?.questionId);
  const optionIds = Array.isArray(req.body?.optionIds) ? req.body.optionIds.map(String).map(s => s.trim()).filter(Boolean) : [];
  const value = String(req.body?.value ?? "").trim();

  if (!participantId || !questionId) return res.status(400).json({ error: "invalid_answer" });

  const game = await models.Game.findByPk(req.game.id);
  const question = await models.Question.findByPk(questionId, { include: [models.Option] });
  if (!question || question.GameId !== req.game.id) return res.status(403).json({ error: "wrong_question" });
  const questionType = normalizeQuestionType(question.type);

  // Security: bei Player-Token nur PlayerId erlauben
  if (req.link.type === "player") {
    if (participantId !== game.PlayerId) return res.status(403).json({ error: "not_player" });
  }

  const isGuestAsync = req.link.type === "guest_async";
  if (game.status === "finished") return res.status(400).json({ error: "game_finished" });
  if (!isGuestAsync && game.status !== "live") return res.status(400).json({ error: "not_live" });
  if (isGuestAsync && !["setup", "live"].includes(game.status)) return res.status(400).json({ error: "not_open" });

  const orderedQuestions = await models.Question.findAll({
    where: { GameId: req.game.id },
    attributes: ["id"],
    order: [["sortOrder", "ASC"], ["id", "ASC"]]
  });
  const questionIdx = orderedQuestions.findIndex(q => q.id === questionId);
  if (questionIdx < 0) return res.status(404).json({ error: "not_found" });
  // Während "live": Änderung nur bis zur Auflösung erlaubt.
  if (game.status === "live" && questionIdx <= Number(game.revealedQuestionIndex || -1)) {
    return res.status(409).json({ error: "answer_locked" });
  }

  // bei Gäste-Token nur guest Participants erlauben (MVP: nur check, dass Participant zum Spiel gehört)
  const p = await models.Participant.findByPk(participantId);
  if (!p || p.GameId !== req.game.id) return res.status(403).json({ error: "wrong_game" });
  if ((req.link.type === "guest_live" || req.link.type === "guest_async") && p.kind !== "guest") {
    return res.status(403).json({ error: "not_guest" });
  }
  if (req.link.type === "player" && p.kind !== "player") {
    return res.status(403).json({ error: "not_player" });
  }

  const optionIdSet = new Set((question.Options || []).map(o => String(o.id)));
  let storedOptionIds = "";
  if (questionType === "estimate") {
    const rawGuess = String(value || optionIds[0] || "").replace(",", ".").trim();
    const guess = Number(rawGuess);
    if (!Number.isFinite(guess)) return res.status(400).json({ error: "invalid_answer" });
    storedOptionIds = String(guess);
  } else if (questionType === "order") {
    if (!optionIdSet.size || optionIds.length !== optionIdSet.size) {
      return res.status(400).json({ error: "invalid_answer" });
    }
    const unique = new Set(optionIds);
    if (unique.size !== optionIds.length) return res.status(400).json({ error: "invalid_answer" });
    if (optionIds.some(id => !optionIdSet.has(String(id)))) return res.status(400).json({ error: "wrong_option" });
    storedOptionIds = optionIds.join(",");
  } else {
    if (optionIds.length < 1) return res.status(400).json({ error: "invalid_answer" });
    const unique = [...new Set(optionIds.map(String))];
    if (unique.some(id => !optionIdSet.has(id))) return res.status(400).json({ error: "wrong_option" });
    if (!question.allowMultiple && unique.length !== 1) return res.status(400).json({ error: "invalid_answer" });
    storedOptionIds = question.allowMultiple ? unique.sort().join(",") : unique[0];
  }

  const existing = await models.Answer.findOne({ where: { ParticipantId: participantId, QuestionId: questionId } });
  const payload = { ParticipantId: participantId, QuestionId: questionId, optionIds: storedOptionIds };
  if (existing) await existing.update(payload);
  else await models.Answer.create(payload);

  io.to(gameRoom(req.game.id)).emit("answer_received", { participantId, questionId });
  scheduleEmitGameState(req.game.id);
  await scheduleAutoRevealIfReady(req.game.id);
  res.json({ ok: true });
});

/**
 * Websocket
 */
io.on("connection", (socket) => {
  socket.on("join_game", async ({ token }) => {
    const data = await getGameByToken(models, token);
    if (!data) return socket.emit("error_msg", { error: "invalid_token" });

    socket.join(gameRoom(data.game.id));
    socket.emit("joined", { gameId: data.game.id, linkType: data.link.type });
    if (SOCKET_JOIN_SEND_STATE) {
      await emitGameStateToSocket(socket, data.game.id);
    }
  });

  // Client keep-alive (hilft gegen Idle-Timeouts bei Proxies / Mobilfunk)
  socket.on("keep_alive", () => {
    socket.emit("keep_alive_ack", { ts: Date.now() });
  });
});

// Admin: Alle Gäste + Antworten löschen (Fragen bleiben erhalten)
app.post("/api/admin/:token/clear_all", requireToken, async (req, res) => {
  if (req.link.type !== "admin") return res.status(403).json({ error: "forbidden" });
  clearAutoRevealTimer(req.game.id);

  // Alle Gäste des Spiels löschen (Answers werden per CASCADE gelöscht)
  await models.Participant.destroy({ where: { GameId: req.game.id, kind: "guest" } });
  // Sicherheitshalber alle Answers zu Spiel-Fragen löschen (inkl. Player-Antworten)
  const full = await loadGameFull(models, req.game.id);
  const qIds = (full?.Questions || []).map(q => q.id);
  if (qIds.length) await models.Answer.destroy({ where: { QuestionId: qIds } });

  // Spiel auf Setup zurücksetzen (Fragen bleiben)
  await models.Game.update(
    { status: "setup", currentQuestionIndex: 0, phase: "answering", revealedQuestionIndex: -1, winner: null },
    { where: { id: req.game.id } }
  );

  await emitGameState(req.game.id);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "media_too_large" });
    }
    return res.status(400).json({ error: "media_upload_error", detail: err.message });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large" });
  }
  return next(err);
});

server.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
});
