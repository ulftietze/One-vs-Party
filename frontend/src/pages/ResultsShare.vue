<template>
  <div style="max-width:920px; margin:30px auto; padding:0 16px;">
    <div v-if="loading" style="opacity:0.8;">Loading results…</div>
    <div v-else-if="error" style="color:#b91c1c; font-weight:700;">{{ error }}</div>
    <div v-else>
      <h1 style="margin:0 0 6px; color:#004e96;">{{ data.title }}</h1>
      <div style="opacity:0.78; margin-bottom:12px;">Status: <b>{{ data.status }}</b> · Winner: <b>{{ data.winner }}</b></div>

      <div v-if="data.personal" style="margin-bottom:12px; padding:14px; border:2px solid #93c5fd; border-radius:12px; background:#eff6ff;">
        <div style="font-size:18px; font-weight:900; color:#1d4ed8; margin-bottom:4px;">Your personal result card</div>
        <div style="font-size:16px; font-weight:800; color:#0f172a;">#{{ data.personal.rank }} · <span data-no-i18n="1">{{ data.personal.nickname }}</span> · {{ data.personal.score }} pts.</div>
        <div style="margin-top:6px; opacity:0.85;">{{ data.personal.text }}</div>
      </div>

      <div v-if="data.winnerText" data-no-i18n="1" style="margin-bottom:12px; padding:12px; border:1px solid #c7d2fe; border-radius:10px; background:#eef2ff; white-space:pre-wrap;">
        {{ data.winnerText }}
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
        <button @click="copyLink"
                style="padding:10px 12px; border-radius:10px; border:0; background:#004e96; color:#fff; font-weight:800; cursor:pointer;">
          {{ data.personal ? "Copy personal link" : "Copy link" }}
        </button>
        <a :href="activeImageUrl" target="_blank"
           style="padding:10px 12px; border-radius:10px; border:1px solid #004e96; background:#fff; color:#004e96; text-decoration:none; font-weight:800;">
          {{ data.personal ? "Open personal PNG" : "Open ranking PNG" }}
        </a>
      </div>
      <div v-if="message" style="font-size:13px; opacity:0.8; margin-bottom:10px;">{{ message }}</div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
        <div style="padding:12px; border:1px solid #eee; border-radius:12px;">
          <div data-no-i18n="1" style="font-weight:900; color:#e10011;">{{ data.playerName }}</div>
          <div style="font-size:28px; font-weight:900;">{{ data.score?.player || 0 }}</div>
        </div>
        <div style="padding:12px; border:1px solid #eee; border-radius:12px;">
          <div style="font-weight:900; color:#004e96;">Guest team</div>
          <div style="font-size:28px; font-weight:900;">{{ data.score?.guests || 0 }}</div>
        </div>
      </div>

      <div style="border:1px solid #eee; border-radius:12px; padding:12px;">
        <div style="font-size:18px; font-weight:900; margin-bottom:8px;">Ranking</div>
        <div v-if="!data.rankings?.length" style="opacity:0.8;">No ranking available yet.</div>
        <div v-else style="display:grid; gap:8px;">
          <div v-for="r in data.rankings" :key="`${r.rank}-${r.nickname}`"
               style="display:flex; justify-content:space-between; align-items:center; border:1px solid #eee; border-radius:10px; padding:8px 10px;">
            <div style="font-weight:800;">#{{ r.rank }} <span data-no-i18n="1">{{ r.nickname }}</span></div>
            <div style="font-weight:900; color:#004e96;">{{ r.score }} pts.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import api from "../api.js";
import { resultsImageUrlFromToken, resultsShareUrlFromToken } from "../linkUtils.js";
import { setLanguage, useI18n } from "../i18n.js";

const props = defineProps({ token: String });
const route = useRoute();

const loading = ref(true);
const error = ref("");
const { t } = useI18n();
const data = ref({
  title: "",
  status: "",
  winner: "",
  winnerText: "",
  playerName: "Player",
  score: { player: 0, guests: 0 },
  rankings: [],
  personal: null
});
const message = ref("");
const participantId = computed(() => {
  const raw = Number(route.query?.p || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
});
const activeShareUrl = computed(() => resultsShareUrlFromToken(props.token, participantId.value));
const activeImageUrl = computed(() => resultsImageUrlFromToken(props.token, participantId.value));

onMounted(async () => {
  try {
    const params = participantId.value ? { p: participantId.value } : {};
    const res = await api.get(`/public/results/${props.token}`, { params });
    data.value = res.data || data.value;
    if (res?.data?.language) {
      await setLanguage(res.data.language);
    }
  } catch (err) {
    error.value = err?.response?.data?.error || t("Result not available.");
  } finally {
    loading.value = false;
  }
});

async function copyLink() {
  const url = activeShareUrl.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    message.value = t("Link copied.");
  } catch {
    message.value = t("Copy failed.");
  }
}
</script>
