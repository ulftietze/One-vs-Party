const API_BASE = String(import.meta.env.VITE_API_BASE || "/api");

function normalizedAppBase() {
  if (typeof window === "undefined") return "";
  const origin = String(window.location.origin || "");
  const pathname = String(window.location.pathname || "/");
  const basePath = pathname.endsWith("/") ? pathname : pathname.replace(/\/[^/]*$/, "/");
  return `${origin}${basePath}`;
}

export function appLinkFromToken(type, token) {
  const t = String(token || "").trim();
  if (!t) return "";

  const routeByType = {
    admin: `/admin/${t}`,
    present: `/present/${t}`,
    guest_live: `/guest/live/${t}`,
    guest_async: `/guest/async/${t}`,
    player: `/player/${t}`,
    results: `/results/${t}`
  };
  const route = routeByType[String(type || "")];
  if (!route) return "";
  return `${normalizedAppBase()}#${route}`;
}

export function appLinksFromTokens(tokens = {}) {
  const out = {};
  for (const [key, value] of Object.entries(tokens || {})) {
    const link = appLinkFromToken(key, value);
    if (link) out[key] = link;
  }
  return out;
}

export function qrUrlForTargetUrl(targetUrl) {
  const url = String(targetUrl || "").trim();
  if (!url) return "";
  const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
  return `${base}/qr.png?u=${encodeURIComponent(url)}`;
}

function normalizedApiBasePath() {
  const raw = String(API_BASE || "/api").trim() || "/api";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return parsed.pathname || "/api";
    } catch {
      return "/api";
    }
  }
  if (raw.startsWith("/")) return raw;
  if (typeof window === "undefined") return `/${raw}`;
  const pathname = String(window.location.pathname || "/");
  const basePath = pathname.endsWith("/") ? pathname : pathname.replace(/\/[^/]*$/, "/");
  return `${basePath}${raw}`.replace(/\/{2,}/g, "/");
}

function normalizedApiBaseUrl() {
  const basePath = normalizedApiBasePath().replace(/\/+$/, "");
  if (typeof window === "undefined") return basePath || "/api";
  return `${window.location.origin}${basePath || "/api"}`;
}

export function apiUrlFromPath(pathname) {
  const cleanPath = String(pathname || "").trim();
  if (!cleanPath) return normalizedApiBaseUrl();
  const withSlash = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
  return `${normalizedApiBaseUrl()}${withSlash}`;
}

export function resultsShareUrlFromToken(token, participantId = null) {
  const base = appLinkFromToken("results", token);
  if (!base) return "";
  const id = Number(participantId || 0);
  return Number.isFinite(id) && id > 0 ? `${base}?p=${id}` : base;
}

export function resultsImageUrlFromToken(token, participantId = null) {
  const t = String(token || "").trim();
  if (!t) return "";
  const id = Number(participantId || 0);
  const query = Number.isFinite(id) && id > 0 ? `?p=${id}` : "";
  return apiUrlFromPath(`/public/results/${t}.png${query}`);
}
