<template>
  <div style="max-width:900px; margin:40px auto; padding:0 16px;">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
      <h1 style="margin:0 0 8px;">Admin</h1>
      <label style="display:flex; gap:8px; align-items:center; font-size:13px; font-weight:700;">
        UI language
        <select v-model="language" @change="onUiLanguageChange"
                style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff;">
          <option v-for="lang in availableLanguages" :key="lang.code" :value="lang.code">{{ lang.label }}</option>
        </select>
      </label>
    </div>
    <div style="opacity:0.75; margin-bottom:16px;">Manage games and create a new game</div>

    <div style="border:1px solid #eee; border-radius:14px; padding:16px; display:grid; gap:10px; margin-bottom:16px;">
      <div style="font-weight:800;">Master admin session</div>

      <template v-if="!adminSession">
        <div style="font-size:13px; opacity:0.75;">Login with env <b>ADMIN_TOKEN</b> (afterwards everything runs via session token)</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input v-model="adminSecret" placeholder="ADMIN_TOKEN"
                 style="flex:1; min-width:220px; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <button @click="login"
                  style="padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:800;">
            Login
          </button>
        </div>
      </template>

      <template v-else>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <div style="font-size:13px; opacity:0.75;">Session active</div>
          <button @click="loadGames"
                  style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff; font-weight:800;">
            Reload
          </button>
          <button @click="logout"
                  style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff; font-weight:800;">
            Logout
          </button>
        </div>
      </template>

      <div v-if="gamesLoading" style="opacity:0.8; font-size:14px;">Loading…</div>
      <div v-else-if="games.length===0 && !gamesMsg && adminSession" style="opacity:0.8; font-size:14px;">No games found.</div>
      <div v-else-if="adminSession" style="display:grid; gap:10px;">
        <div v-for="g in games" :key="g.id"
             style="border:1px solid #eee; border-radius:12px; padding:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <div style="flex:1; min-width:240px;">
            <div style="font-weight:900;">{{ g.title }}</div>
            <div style="font-size:13px; opacity:0.75;">
              Status: <b>{{ g.status }}</b> · Published: <b>{{ g.isPublished ? "yes" : "no" }}</b> · UI: <b>{{ g.uiLanguage || "en" }}</b>
            </div>
          </div>
          <button @click="openAdmin(g)"
                  :disabled="!g.tokens?.admin"
                  style="padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:800;">
            Edit
          </button>
          <button @click="deleteGame(g)"
                  style="padding:10px 12px; border-radius:12px; border:1px solid #e10011; background:#fff1f2; color:#7f1d1d; font-weight:800;">
            Delete
          </button>
          <button @click="exportFullGame(g)"
                  style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800;">
            Export full quiz
          </button>
          <a v-if="g.tokens?.present" :href="gamePresentLink(g)" style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800; text-decoration:none; color:inherit;">
            Presentation
          </a>
          <a v-if="g.tokens?.results" :href="gameResultsLink(g)" style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800; text-decoration:none; color:inherit;">
            Results
          </a>
        </div>
      </div>

      <div v-if="gamesMsg" style="font-size:13px; opacity:0.8;">{{ gamesMsg }}</div>

      <div v-if="adminSession" style="margin-top:8px; border-top:1px solid #eee; padding-top:12px; display:grid; gap:10px;">
        <div style="font-weight:800;">Import full quiz</div>
        <div style="font-size:13px; opacity:0.75;">
          Imports title, player, game settings, winner texts, final media and all questions with media.
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <input ref="fullImportInput" type="file" accept=".json,application/json" @change="onFullImportFileChange"
                 style="padding:8px; border:1px solid #ddd; border-radius:10px; background:#fff;" />
          <button @click="importFullGame"
                  :disabled="fullImportBusy || !fullImportFile"
                  :style="fullImportBusy || !fullImportFile
                    ? 'padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#f5f5f5; color:#777; font-weight:800;'
                    : 'padding:10px 12px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800;'">
            Import full quiz
          </button>
        </div>
      </div>
    </div>

    <div style="display:grid; gap:10px; border:1px solid #eee; border-radius:14px; padding:16px;">
      <input v-model="title" placeholder="Title, e.g. 60th Birthday"
             style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
      <input v-model="playerName" placeholder="Player name"
             style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
      <label style="display:flex; gap:8px; align-items:center; font-size:13px; font-weight:700;">
        Game UI language
        <select v-model="newGameLanguage"
                style="padding:8px 10px; border-radius:10px; border:1px solid #ddd; background:#fff;">
          <option v-for="lang in availableLanguages" :key="`new-${lang.code}`" :value="lang.code">{{ lang.label }}</option>
        </select>
      </label>

      <button @click="create"
              :disabled="!adminSession"
              style="padding:10px 12px; border-radius:12px; border:0; background:#111; color:#fff; font-weight:800;">
        Create game
      </button>

      <div v-if="created" style="display:grid; gap:8px; font-size:14px; margin-top:6px;">
        <div><b>Admin link</b>: <a :href="createdUrls.admin">{{ createdUrls.admin }}</a></div>
        <div><b>Presentation link</b>: <a :href="createdUrls.present">{{ createdUrls.present }}</a></div>
        <div><b>Guest live</b>: <a :href="createdUrls.guest_live">{{ createdUrls.guest_live }}</a></div>
        <div><b>Guest async</b>: <a :href="createdUrls.guest_async">{{ createdUrls.guest_async }}</a></div>
        <div><b>Player</b>: <a :href="createdUrls.player">{{ createdUrls.player }}</a></div>
        <div v-if="createdUrls.results"><b>Results</b>: <a :href="createdUrls.results">{{ createdUrls.results }}</a></div>

        <div style="margin-top:6px; font-size:13px; opacity:0.85;">
          QR codes (PNG):<br />
          Live: <a :href="createdQrUrl('guest_live')" target="_blank">PNG</a> ·
          Async: <a :href="createdQrUrl('guest_async')" target="_blank">PNG</a> ·
          Player: <a :href="createdQrUrl('player')" target="_blank">PNG</a> ·
          Presentation: <a :href="createdQrUrl('present')" target="_blank">PNG</a>
          <span v-if="createdUrls.results"> · Results: <a :href="createdQrUrl('results')" target="_blank">PNG</a></span>
        </div>
      </div>

      <div v-if="msg" style="font-size:13px; opacity:0.8;">{{ msg }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import api from "../api.js";
import { appLinkFromToken, appLinksFromTokens, qrUrlForTargetUrl } from "../linkUtils.js";
import { useI18n } from "../i18n.js";

const router = useRouter();
const { t, availableLanguages, language, setLanguage } = useI18n();

const title = ref("Quiz");
const playerName = ref("Player");
const newGameLanguage = ref(language.value || "en");
const created = ref(null);
const msg = ref("");

const adminSecret = ref(localStorage.getItem("ADMIN_TOKEN") || "");
const adminSession = ref(localStorage.getItem("ADMIN_SESSION_TOKEN") || "");
const games = ref([]);
const gamesLoading = ref(false);
const gamesMsg = ref("");
const fullImportFile = ref(null);
const fullImportInput = ref(null);
const fullImportBusy = ref(false);

const createdUrls = computed(() => appLinksFromTokens(created.value?.tokens || {}));

function adminHeaders() {
  return { headers: { "x-admin-session": adminSession.value } };
}

function fileNameFromDisposition(disposition, fallback) {
  const raw = String(disposition || "");
  const star = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) return decodeURIComponent(star[1]);
  const plain = raw.match(/filename=\"?([^\";]+)\"?/i);
  return plain?.[1] || fallback;
}

function downloadBlob(blob, fileName) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1200);
}

onMounted(async () => {
  if (!adminSession.value) return;
  const ok = await validateSession();
  if (ok) await loadGames();
});

async function onUiLanguageChange() {
  await setLanguage(language.value);
  newGameLanguage.value = language.value;
}

async function validateSession() {
  const { data } = await api.get("/admin/session", adminHeaders())
    .catch(() => ({ data: { error: "invalid" } }));
  if (data?.ok) return true;
  adminSession.value = "";
  localStorage.removeItem("ADMIN_SESSION_TOKEN");
  return false;
}

async function login() {
  gamesMsg.value = "";
  localStorage.setItem("ADMIN_TOKEN", adminSecret.value);
  const { data } = await api.post("/admin/login", { secret: adminSecret.value })
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (!data?.sessionToken) {
    gamesMsg.value = data?.error === "forbidden" ? t("Login failed.") : t("Error: {error}", { error: data?.error || "error" });
    return;
  }
  adminSession.value = String(data.sessionToken);
  localStorage.setItem("ADMIN_SESSION_TOKEN", adminSession.value);
  await loadGames();
}

async function logout() {
  await api.post("/admin/logout", {}, adminHeaders()).catch(() => ({}));
  adminSession.value = "";
  localStorage.removeItem("ADMIN_SESSION_TOKEN");
  games.value = [];
  gamesMsg.value = t("Signed out.");
}

async function loadGames() {
  if (!adminSession.value) {
    gamesMsg.value = t("Please login first.");
    return;
  }

  gamesMsg.value = "";
  gamesLoading.value = true;
  games.value = [];
  const { data } = await api.get("/admin/master/games", adminHeaders())
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  gamesLoading.value = false;

  if (data?.games) {
    games.value = data.games;
    return;
  }

  if (data?.error === "invalid_admin_session" || data?.error === "missing_admin_session") {
    adminSession.value = "";
    localStorage.removeItem("ADMIN_SESSION_TOKEN");
    gamesMsg.value = t("Session expired. Please login again.");
    return;
  }
  gamesMsg.value = t("Error: {error}", { error: data?.error || "error" });
}

async function deleteGame(game) {
  const id = Number(game?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return;
  if (!confirm(t("Delete game \"{title}\"? This action cannot be undone.", { title: game?.title || id }))) return;
  const { data } = await api.delete(`/admin/master/games/${id}`, adminHeaders())
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.ok) {
    gamesMsg.value = t("Game deleted.");
    await loadGames();
    return;
  }
  if (data?.error === "invalid_admin_session" || data?.error === "missing_admin_session") {
    adminSession.value = "";
    localStorage.removeItem("ADMIN_SESSION_TOKEN");
    gamesMsg.value = t("Session expired. Please login again.");
    return;
  }
  gamesMsg.value = t("Error: {error}", { error: data?.error || "error" });
}

async function openAdmin(game) {
  const token = game?.tokens?.admin;
  if (!token) return;
  await setLanguage(game?.uiLanguage || language.value || "en");
  router.push(`/admin/${token}`);
}

function gamePresentLink(game) {
  return appLinkFromToken("present", game?.tokens?.present);
}

function gameResultsLink(game) {
  return appLinkFromToken("results", game?.tokens?.results);
}

function createdQrUrl(type) {
  return qrUrlForTargetUrl(createdUrls.value?.[type] || "");
}

async function exportFullGame(game) {
  const id = Number(game?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return;
  const res = await api.get(`/admin/master/games/${id}/export`, {
    ...adminHeaders(),
    responseType: "blob"
  }).catch(() => null);
  if (!res?.data) {
    gamesMsg.value = t("Export failed.");
    return;
  }
  const fallbackName = `quiz_${id}_full.json`;
  const fileName = fileNameFromDisposition(res?.headers?.["content-disposition"], fallbackName);
  downloadBlob(res.data, fileName);
  gamesMsg.value = t("Full quiz export ready.");
}

function onFullImportFileChange(evt) {
  fullImportFile.value = evt?.target?.files?.[0] || null;
}

async function importFullGame() {
  if (!fullImportFile.value) return;
  fullImportBusy.value = true;
  const form = new FormData();
  form.append("file", fullImportFile.value);
  const { data } = await api.post("/admin/master/games/import", form, adminHeaders())
    .catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  fullImportBusy.value = false;
  if (!data?.ok) {
    gamesMsg.value = t("Error: {error}", { error: data?.error || "error" });
    return;
  }
  fullImportFile.value = null;
  if (fullImportInput.value) fullImportInput.value.value = "";
  gamesMsg.value = t("Full quiz imported.");
  await loadGames();
}

async function create() {
  msg.value = "";
  if (!adminSession.value) {
    msg.value = t("Please login first.");
    return;
  }

  const { data } = await api.post("/games", {
    title: title.value,
    playerName: playerName.value,
    uiLanguage: newGameLanguage.value || "en"
  }, adminHeaders()).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.tokens) {
    created.value = data;
    await loadGames();
    return;
  }

  if (data?.error === "invalid_admin_session" || data?.error === "missing_admin_session") {
    adminSession.value = "";
    localStorage.removeItem("ADMIN_SESSION_TOKEN");
    msg.value = t("Session expired. Please login again.");
    return;
  }
  msg.value = t("Error: {error}", { error: data?.error || "error" });
}
</script>
