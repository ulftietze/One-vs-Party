import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import api from "./api.js";

const SOURCE_LANGUAGE = "en";
const LANGUAGE_STORAGE_KEY = "quizduell_ui_language";

const language = ref(normalizeLanguageCode(localStorage.getItem(LANGUAGE_STORAGE_KEY) || SOURCE_LANGUAGE));
const availableLanguages = ref([{ code: SOURCE_LANGUAGE, label: "English" }]);
const translationRevision = ref(0);

const loadedTranslations = new Map([[SOURCE_LANGUAGE, { direct: new Map(), patterns: [] }]]);
const rootElements = new Set();
const textNodeState = new WeakMap();
const elementAttrState = new WeakMap();
let availableLanguagesLoaded = false;

function normalizeLanguageCode(raw) {
  const code = String(raw || "").trim().replace("_", "-").toLowerCase();
  if (!code) return SOURCE_LANGUAGE;
  const primary = code.split("-")[0] || SOURCE_LANGUAGE;
  if (!/^[a-z]{2,8}$/.test(primary)) return SOURCE_LANGUAGE;
  return primary;
}

function pairForLanguage(code) {
  const lang = normalizeLanguageCode(code);
  if (lang === SOURCE_LANGUAGE) return null;
  return `en_${lang.toUpperCase()}`;
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

function compilePatterns(directMap) {
  const patterns = [];
  for (const [source, target] of directMap.entries()) {
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

async function loadLanguageList() {
  if (availableLanguagesLoaded) return availableLanguages.value;
  const { data } = await api.get("/i18n/languages").catch(() => ({ data: null }));
  const loadedFromApi = Array.isArray(data?.languages);
  const list = loadedFromApi ? data.languages : [{ code: SOURCE_LANGUAGE, label: "English" }];
  const normalized = [];
  const seen = new Set();
  for (const item of list) {
    const code = normalizeLanguageCode(item?.code);
    if (seen.has(code)) continue;
    seen.add(code);
    normalized.push({
      code,
      label: String(item?.label || code)
    });
  }
  if (!seen.has(SOURCE_LANGUAGE)) {
    normalized.unshift({ code: SOURCE_LANGUAGE, label: "English" });
  }
  availableLanguages.value = normalized;
  availableLanguagesLoaded = loadedFromApi;
  return normalized;
}

async function loadLanguageBundle(code) {
  const lang = normalizeLanguageCode(code);
  if (loadedTranslations.has(lang)) return loadedTranslations.get(lang);
  const pair = pairForLanguage(lang);
  if (!pair) return loadedTranslations.get(SOURCE_LANGUAGE);

  const { data } = await api.get(`/i18n/${pair}.csv`, { responseType: "text" }).catch(() => ({ data: "" }));
  const direct = new Map();
  for (const row of parseCsvRows(data || "")) {
    const source = String(row[0] || "").trim();
    if (!source || source.startsWith("#")) continue;
    direct.set(source, String(row[1] || ""));
  }
  const bundle = { direct, patterns: compilePatterns(direct) };
  loadedTranslations.set(lang, bundle);
  translationRevision.value += 1;
  return bundle;
}

function translateText(source, vars = {}, languageOverride = language.value) {
  const sourceText = String(source ?? "");
  const base = interpolate(sourceText, vars);
  const lang = normalizeLanguageCode(languageOverride);
  if (lang === SOURCE_LANGUAGE) return base;

  const bundle = loadedTranslations.get(lang);
  if (!bundle) return base;

  const direct = bundle.direct.get(sourceText);
  if (direct !== undefined) return interpolate(direct, vars);

  for (const pattern of bundle.patterns) {
    const match = sourceText.match(pattern.regex);
    if (!match) continue;
    const inferredVars = { ...vars };
    for (let i = 0; i < pattern.varNames.length; i++) {
      const key = pattern.varNames[i];
      if (!Object.prototype.hasOwnProperty.call(inferredVars, key)) {
        inferredVars[key] = match[i + 1] ?? "";
      }
    }
    return interpolate(pattern.target, inferredVars);
  }

  return base;
}

function applyTextTranslation(node) {
  const current = String(node.textContent || "");
  if (!current.trim()) return;
  if (node?.parentElement?.closest?.("[data-no-i18n]")) return;

  const existing = textNodeState.get(node);
  const state = existing || { source: current, rendered: current };
  if (existing && current !== state.rendered) {
    state.source = current;
  }

  const sourceWithWhitespace = String(state.source || "");
  const m = sourceWithWhitespace.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const prefix = m?.[1] || "";
  const core = m?.[2] || "";
  const suffix = m?.[3] || "";
  const translatedCore = core.trim() ? translateText(core) : core;
  const translated = `${prefix}${translatedCore}${suffix}`;
  if (translated !== current) {
    node.textContent = translated;
  }
  state.rendered = translated;
  textNodeState.set(node, state);
}

function applyAttributeTranslation(element, attributeName) {
  const current = element.getAttribute(attributeName);
  if (current === null || !String(current).trim()) return;
  if (element?.closest?.("[data-no-i18n]")) return;

  let attrMap = elementAttrState.get(element);
  if (!attrMap) {
    attrMap = new Map();
    elementAttrState.set(element, attrMap);
  }

  const existing = attrMap.get(attributeName);
  const state = existing || { source: current, rendered: current };
  if (existing && current !== state.rendered) {
    state.source = current;
  }

  const translated = translateText(state.source);
  if (translated !== current) {
    element.setAttribute(attributeName, translated);
  }
  state.rendered = translated;
  attrMap.set(attributeName, state);
}

function applyTranslationsToRoot(root) {
  if (!root) return;
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (textWalker.nextNode()) {
    const node = textWalker.currentNode;
    if (!node?.parentElement) continue;
    const tag = node.parentElement.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    applyTextTranslation(node);
  }

  const translateAttrs = (el) => {
    applyAttributeTranslation(el, "placeholder");
    applyAttributeTranslation(el, "title");
    applyAttributeTranslation(el, "aria-label");
    applyAttributeTranslation(el, "alt");
  };

  if (root.nodeType === 1) translateAttrs(root);
  root.querySelectorAll?.("[placeholder],[title],[aria-label],[alt]").forEach(translateAttrs);
}

function applyTranslationsToAllRoots() {
  for (const root of rootElements) {
    applyTranslationsToRoot(root);
  }
}

export async function initI18n() {
  await loadLanguageList();
  if (!availableLanguages.value.some(x => x.code === language.value)) {
    language.value = SOURCE_LANGUAGE;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language.value);
  }
  await loadLanguageBundle(language.value);
  applyTranslationsToAllRoots();
}

export async function setLanguage(code) {
  await loadLanguageList();
  const normalized = normalizeLanguageCode(code);
  const supported = availableLanguages.value.some(x => x.code === normalized);
  const next = supported ? normalized : SOURCE_LANGUAGE;
  await loadLanguageBundle(next);
  if (language.value !== next) {
    language.value = next;
  }
  localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  applyTranslationsToAllRoots();
}

export function useI18n() {
  const t = (source, vars = {}) => {
    const lang = language.value;
    const rev = translationRevision.value;
    void rev;
    return translateText(source, vars, lang);
  };
  return {
    t,
    language,
    availableLanguages: computed(() => availableLanguages.value),
    setLanguage
  };
}

export function useAutoTranslateRoot(rootRef) {
  let observer = null;

  const start = () => {
    const root = rootRef?.value;
    if (!root) return;
    rootElements.add(root);
    applyTranslationsToRoot(root);
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => applyTranslationsToRoot(root));
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label", "alt"]
    });
  };

  onMounted(() => {
    start();
  });

  onBeforeUnmount(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    const root = rootRef?.value;
    if (root) rootElements.delete(root);
  });

  watch([language, translationRevision], () => {
    const root = rootRef?.value;
    if (root) applyTranslationsToRoot(root);
  });
}
