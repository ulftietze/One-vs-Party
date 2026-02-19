<template>
  <div style="max-width:900px; margin:40px auto; padding:0 16px;">
    <h1 style="margin:0 0 8px; color:#004e96;">Quiz Duel</h1>
    <div style="opacity:0.75; margin-bottom:18px;">
      Open the presentation for an existing game
    </div>

    <div style="border:1px solid #eee; border-radius:14px; padding:16px; display:grid; gap:10px;">
      <div style="font-weight:800;">Select published game</div>

      <div v-if="loading" style="opacity:0.8; font-size:14px;">Loading games…</div>
      <div v-else>
        <select v-model="selected" style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;">
          <option value="">Please select…</option>
          <option v-for="g in games" :key="g.id" :value="g.presentToken">
            {{ g.title }} ({{ g.status }})
          </option>
        </select>
      </div>

      <button @click="openSelected"
              :disabled="!selected"
              style="padding:12px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800; opacity:1; cursor:pointer;">
        Open presentation
      </button>

      <details style="margin-top:6px;">
        <summary style="cursor:pointer; font-weight:700;">Open token manually</summary>
        <div style="display:grid; gap:10px; margin-top:10px;">
          <input v-model="input" placeholder="e.g. https://.../#/t/XXXXXXXX or token"
                 style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
          <button @click="openByToken"
                  style="padding:10px 12px; border-radius:12px; border:1px solid #ddd; background:#fff; font-weight:800;">
            Open
          </button>
        </div>
      </details>

      <div v-if="msg" style="font-size:13px; opacity:0.85;">{{ msg }}</div>
    </div>

    <div v-if="token" style="margin-top:16px; padding:14px; border:1px solid #eee; border-radius:12px;">
      <div style="font-weight:700;">Token found</div>
      <div style="opacity:0.8; margin-top:6px;">Redirecting…</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import api from "../api.js";
import { setLanguage } from "../i18n.js";

const route = useRoute();
const router = useRouter();

const token = route.params.token;
const input = ref("");
const msg = ref("");
const games = ref([]);
const selected = ref("");
const loading = ref(true);

function extractToken(val) {
  const s = (val || "").trim();
  if (!s) return "";
  // akzeptiert Token direkt
  if (/^[A-Za-z0-9_-]{10,64}$/.test(s)) return s;

  // versucht Token aus URL/Hash zu extrahieren: .../#/t/<token> oder /t/<token>
  const m = s.match(/\/t\/([A-Za-z0-9_-]{10,64})/);
  if (m) return m[1];
  const m2 = s.match(/#\/t\/([A-Za-z0-9_-]{10,64})/);
  if (m2) return m2[1];
  return "";
}

onMounted(async () => {
  if (token) {
    // If someone opens /#/t/<token>, detect link type and route accordingly.
    const { data } = await api.get(`/state/${token}`);
    if (data?.game?.uiLanguage) {
      await setLanguage(data.game.uiLanguage);
    }
    const t = token;
    const type = data.linkType;

    const map = {
      admin: `/admin/${t}`,
      present: `/present/${t}`,
      guest_live: `/guest/live/${t}`,
      guest_async: `/guest/async/${t}`,
      player: `/player/${t}`,
      results: `/results/${t}`
    };

    router.replace(map[type] || "/");
  }

  // Load published games.
  const { data } = await api.get("/public/games").catch(() => ({ data: { games: [] } }));
  games.value = data?.games || [];
  loading.value = false;
});

function openSelected() {
  msg.value = "";
  if (!selected.value) return;
  router.push(`/present/${selected.value}`);
}

async function openByToken() {
  msg.value = "";
  const t = extractToken(input.value);
  if (!t) {
    msg.value = "No valid token found.";
    return;
  }

  const { data } = await api.get(`/state/${t}`).catch(() => ({ data: { error: "invalid_token" } }));
  if (data?.error) {
    msg.value = "Token is invalid.";
    return;
  }

  if (data.linkType !== "present") {
    msg.value = "This is not a presentation token.";
    return;
  }

  router.push(`/present/${t}`);
}
</script>
