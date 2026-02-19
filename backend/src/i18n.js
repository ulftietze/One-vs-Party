import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const BASE_LANGUAGE = "en";
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_DIR = path.join(THIS_DIR, "i18n", "translations");

const languageCache = new Map();
let availableLanguagesCache = null;

function normalizeLanguageCode(raw) {
  const code = String(raw || "").trim().replace("_", "-").toLowerCase();
  if (!code) return BASE_LANGUAGE;
  const primary = code.split("-")[0] || BASE_LANGUAGE;
  if (!/^[a-z]{2,8}$/.test(primary)) return BASE_LANGUAGE;
  return primary;
}

function pairForLanguage(languageCode) {
  const language = normalizeLanguageCode(languageCode);
  if (language === BASE_LANGUAGE) return null;
  return `en_${language.toUpperCase()}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function interpolate(template, vars = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key] ?? "");
    return `{${key}}`;
  });
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let value = "";
  let i = 0;
  let inQuotes = false;
  const src = String(content || "");

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (inQuotes && ch === '"' && next === '"') {
      value += '"';
      i += 2;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }

    if (!inQuotes && ch === ",") {
      row.push(value);
      value = "";
      i += 1;
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(value);
      value = "";
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    value += ch;
    i += 1;
  }

  row.push(value);
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
  return rows;
}

function compilePatterns(map) {
  const patterns = [];
  for (const [source, target] of map.entries()) {
    const varNames = [];
    const regexBody = escapeRegExp(source).replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, (_, name) => {
      varNames.push(name);
      return "(.+?)";
    });
    if (!varNames.length) continue;
    patterns.push({
      regex: new RegExp(`^${regexBody}$`),
      varNames,
      target
    });
  }
  return patterns;
}

async function readTranslationMapForLanguage(languageCode) {
  const language = normalizeLanguageCode(languageCode);
  if (language === BASE_LANGUAGE) {
    return { direct: new Map(), patterns: [] };
  }
  if (languageCache.has(language)) return languageCache.get(language);

  const pair = pairForLanguage(language);
  const filePath = path.join(TRANSLATIONS_DIR, `${pair}.csv`);
  let content = "";
  try {
    content = await fsp.readFile(filePath, "utf8");
  } catch {
    const empty = { direct: new Map(), patterns: [] };
    languageCache.set(language, empty);
    return empty;
  }

  const direct = new Map();
  for (const row of parseCsvRows(content)) {
    if (!row.length) continue;
    const source = String(row[0] || "").trim();
    if (!source || source.startsWith("#")) continue;
    const target = String(row[1] || "");
    direct.set(source, target);
  }

  const value = { direct, patterns: compilePatterns(direct) };
  languageCache.set(language, value);
  return value;
}

export async function preloadTranslations() {
  if (availableLanguagesCache) return availableLanguagesCache;

  let entries = [];
  try {
    entries = await fsp.readdir(TRANSLATIONS_DIR, { withFileTypes: true });
  } catch {
    availableLanguagesCache = [BASE_LANGUAGE];
    return availableLanguagesCache;
  }

  const langs = new Set([BASE_LANGUAGE]);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(/^en_([A-Za-z]{2,8})\.csv$/);
    if (!m) continue;
    langs.add(String(m[1] || "").toLowerCase());
  }

  availableLanguagesCache = [...langs].sort((a, b) => {
    if (a === BASE_LANGUAGE) return -1;
    if (b === BASE_LANGUAGE) return 1;
    return a.localeCompare(b);
  });

  await Promise.all(availableLanguagesCache.map(code => readTranslationMapForLanguage(code)));
  return availableLanguagesCache;
}

export async function getAvailableLanguages() {
  const langs = await preloadTranslations();
  const display = new Intl.DisplayNames(["en"], { type: "language" });
  return langs.map(code => ({
    code,
    label: code === "en" ? "English" : (display.of(code) || code)
  }));
}

export function translate(languageCode, source, vars = {}) {
  const base = interpolate(source, vars);
  const language = normalizeLanguageCode(languageCode);
  if (language === BASE_LANGUAGE) return base;

  const bundle = languageCache.get(language);
  if (!bundle) return base;

  const direct = bundle.direct.get(String(source || ""));
  if (direct !== undefined) return interpolate(direct, vars);

  for (const pattern of bundle.patterns) {
    const m = String(source || "").match(pattern.regex);
    if (!m) continue;
    const inferredVars = { ...vars };
    for (let i = 0; i < pattern.varNames.length; i++) {
      const key = pattern.varNames[i];
      if (!Object.prototype.hasOwnProperty.call(inferredVars, key)) {
        inferredVars[key] = m[i + 1] ?? "";
      }
    }
    return interpolate(pattern.target, inferredVars);
  }

  return base;
}

export function normalizeUiLanguage(raw) {
  return normalizeLanguageCode(raw);
}

export function translationFilePathFromPair(rawPair) {
  const pair = String(rawPair || "").trim();
  if (!/^[A-Za-z]{2}_[A-Za-z]{2,8}$/.test(pair)) return null;
  return path.join(TRANSLATIONS_DIR, `${pair}.csv`);
}
