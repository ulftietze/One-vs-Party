<template>
  <div :style="containerStyle">
    <div :style="contentStyle">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <div v-if="state.game?.showQuizTitle !== false" data-no-i18n="1" style="font-size:32px; font-weight:900; color:#004e96;">{{ state.game?.title }}</div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div v-if="state.game?.status!=='live' && state.game?.status!=='finished'" style="opacity:0.75; font-weight:800; align-self:center;">
            Waiting for start in admin
          </div>
          <button v-if="state.game?.status==='live' && state.game?.phase==='answering'" @click="reveal"
                  :disabled="autoRevealPending"
                  :style="autoRevealPending
                    ? 'padding:12px 20px; border-radius:12px; border:0; background:#e10011; color:#fff; font-weight:800; cursor:not-allowed; font-size:18px; opacity:0.65;'
                    : 'padding:12px 20px; border-radius:12px; border:0; background:#e10011; color:#fff; font-weight:800; cursor:pointer; font-size:18px;'">
            Reveal
          </button>
          <button v-else-if="state.game?.status==='live' && state.game?.phase==='revealed'" @click="next"
                  style="padding:12px 20px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800; cursor:pointer; font-size:18px;">
            {{ isLastRevealedQuestion ? t("Show results") : t("Next question") }}
          </button>
        </div>
      </div>

      <transition name="show-bumper">
        <div v-if="showIntermission" class="show-bumper">
          <div class="show-bumper-card">
            <div class="show-bumper-title">Everyone has submitted</div>
            <div class="show-bumper-sub">Reveal starts…</div>
            <div class="show-bumper-dots" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      </transition>

      <div v-if="!state.game?.isPublished" style="opacity:0.8; font-size:24px; font-weight:900; text-align:center; margin-top:40px; color:#004e96;">
        Coming soon
      </div>

      <div v-else-if="state.game?.status==='finished'" style="opacity:0.85; font-size:18px; font-weight:900;">
        <div style="font-size:28px; color:#004e96;">Game finished!</div>
        <div style="margin-top:16px; font-size:24px;">
          Winner:
          <span v-if="state.game?.winner==='player'" data-no-i18n="1" style="color:#e10011;">{{ playerName }}</span>
          <span v-else-if="state.game?.winner==='guests'" style="color:#004e96;">Guests</span>
          <span v-else>Tie</span>
        </div>
        <div v-if="winnerText" data-no-i18n="1" style="margin-top:10px; font-size:18px; font-weight:700; opacity:0.9; white-space:pre-wrap;">
          {{ winnerText }}
        </div>
        <div v-if="shareLink" style="margin-top:18px; padding:12px; border:2px solid #004e96; border-radius:12px; background:#f0f7ff;">
          <div style="font-size:18px; font-weight:900; color:#004e96; margin-bottom:8px;">Share results</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button @click="copyShareLink"
                    style="padding:8px 12px; border-radius:10px; border:0; background:#004e96; color:#fff; font-weight:800; cursor:pointer;">
              Copy link
            </button>
            <a :href="shareLink"
               style="padding:8px 12px; border-radius:10px; border:1px solid #004e96; background:#fff; color:#004e96; font-weight:800; text-decoration:none;">
              Open result link
            </a>
            <a v-if="shareImageUrl" :href="shareImageUrl" target="_blank"
               style="padding:8px 12px; border-radius:10px; border:1px solid #004e96; background:#fff; color:#004e96; font-weight:800; text-decoration:none;">
              Open ranking PNG
            </a>
          </div>
          <div v-if="shareMessage" style="margin-top:8px; font-size:13px; opacity:0.8;">{{ shareMessage }}</div>
        </div>

        <div v-if="topRankings.length > 0" style="margin-top:30px;">
          <div style="font-size:26px; font-weight:900; margin-bottom:12px; color:#004e96;">Who knows {{ playerName }} best?</div>
          <div style="display:grid; gap:8px;">
            <div v-for="(r, i) in topRankings" :key="r.id"
                 style="padding:12px; border-radius:12px; background:#fff; border:2px solid #004e96; display:flex; justify-content:space-between; align-items:center;">
              <div style="font-weight:900; font-size:20px;">
                <span style="color:#e10011; margin-right:10px;">#{{ i + 1 }}</span>
                <span data-no-i18n="1">{{ r.nickname }}</span>
              </div>
              <div style="font-weight:800; font-size:18px;">{{ r.score }} pts.</div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="state.game?.status==='setup'" style="opacity:0.8; font-size:24px; font-weight:900; text-align:center; margin-top:40px; color:#004e96;">
        Waiting for game start
      </div>

      <div v-else-if="currentQuestion" style="flex:1; display:flex; flex-direction:column;">
        <div v-if="state.game?.phase === 'answering'" :key="`answering-${currentQuestion.id}`" class="phase-panel">
          <div data-no-i18n="1" style="font-size:32px; font-weight:800; margin-bottom:14px; line-height:1.2;">
            {{ currentQuestion.text }}
          </div>

          <div v-if="currentQuestion.type==='risk'" class="phase-chip"
               style="margin-bottom:16px; display:inline-block; width:max-content; background:#fff1f2; color:#9f1239; border:1px solid #fecdd3; border-radius:999px; padding:6px 12px; font-weight:900;">
            Risk question: correct +2, wrong -2
          </div>

          <div v-if="currentQuestion.promptImage"
               style="margin-bottom:16px; display:flex; justify-content:center;">
            <img :src="currentQuestion.promptImage" alt="Question image"
                 @click="openFullscreenImage(currentQuestion.promptImage)"
                 class="clickable-image"
                 style="max-width:100%; max-height:300px; object-fit:contain; border:1px solid #ddd; border-radius:12px; padding:8px; background:#fff;" />
          </div>
          <div v-if="currentQuestion.promptAudio"
               style="margin-bottom:16px;">
            <audio :src="currentQuestion.promptAudio" controls preload="metadata" style="width:100%;"></audio>
          </div>
          <div v-if="currentQuestion.promptVideo"
               style="margin-bottom:16px;">
            <video :src="currentQuestion.promptVideo" controls preload="metadata"
                   style="width:100%; max-height:360px; border:1px solid #ddd; border-radius:12px; background:#000;"></video>
          </div>

          <div v-if="currentQuestion.type==='estimate'" class="reveal-card"
               style="padding:18px; border-radius:14px; border:2px solid #004e96; background:#f0f7ff; font-size:22px; font-weight:800;">
            Estimate question in progress.
          </div>

          <div v-else-if="currentQuestion.type==='order'" style="display:grid; gap:12px;">
            <div style="font-size:14px; opacity:0.75;">Put these answers in the correct order:</div>
            <div v-for="(o, optIdx) in presentedOrderOptions" :key="o.id" class="question-option"
                 :style="{ animationDelay: `${Math.min(optIdx, 8) * 70}ms` }"
                 style="padding:16px; border-radius:14px; border:2px solid #ddd; font-size:20px; font-weight:700; background:#fafafa;">
              <div :class="['present-option-body', { 'has-media': !!o.image }]">
                <div v-if="o.image" class="present-option-media">
                  <img :src="o.image" alt="Option image"
                       class="clickable-image present-option-image"
                       @click="openFullscreenImage(o.image)" />
                </div>
                <span data-no-i18n="1" class="present-option-text">{{ o.text || "Option" }}</span>
              </div>
            </div>
          </div>

          <div v-else style="display:grid; gap:12px;">
            <div v-for="(o, optIdx) in currentQuestion.options" :key="o.id" class="question-option"
                 :style="{ animationDelay: `${Math.min(optIdx, 8) * 70}ms` }"
                 style="padding:16px; border-radius:14px; border:2px solid #ddd; font-size:20px; font-weight:700; background:#fafafa;">
              <div :class="['present-option-body', { 'has-media': !!o.image }]">
                <div v-if="o.image" class="present-option-media">
                  <img :src="o.image" alt="Option image"
                       class="clickable-image present-option-image"
                       @click="openFullscreenImage(o.image)" />
                </div>
                <span data-no-i18n="1" class="present-option-text">{{ o.text || "Option" }}</span>
              </div>
            </div>
          </div>

          <div style="margin-top:auto; padding-top:24px; display:flex; gap:24px; flex-wrap:wrap;">
            <div class="progress-card" style="display:flex; align-items:center; gap:14px; padding:10px 14px; border-radius:14px; border:1px solid #eee; min-width:280px;">
              <div :style="playerCircleStyle">
                <span v-if="playerAnswered" style="font-size:32px; font-weight:900; color:#fff;">✓</span>
              </div>
              <div>
                <div style="font-size:13px; text-transform:uppercase; letter-spacing:0.06em; opacity:0.7;">Player</div>
                <div data-no-i18n="1" style="font-size:22px; font-weight:900; color:#e10011;">{{ playerName }}</div>
                <div style="font-size:15px; font-weight:700; opacity:0.75;">
                  {{ playerAnswered ? "Answered" : "Waiting..." }}
                </div>
              </div>
            </div>

            <div class="progress-card" style="display:flex; align-items:center; gap:14px; padding:10px 14px; border-radius:14px; border:1px solid #eee; min-width:340px;">
              <div :style="guestCircleStyle">
                <div style="width:82px; height:82px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center;">
                  <span v-if="guestProgress.done" style="font-size:30px; font-weight:900; color:#15803d;">✓</span>
                  <span v-else style="font-size:22px; font-weight:900; color:#111;">{{ guestPercentLabel }}</span>
                </div>
              </div>
              <div>
                <div style="font-size:13px; text-transform:uppercase; letter-spacing:0.06em; opacity:0.7;">Guests</div>
                <div style="font-size:22px; font-weight:900;" :style="{ color: guestProgressColor }">
                  {{ guestProgress.answered }} / {{ guestProgress.total }}
                </div>
                <div style="font-size:15px; font-weight:700; opacity:0.75;">
                  {{ guestProgress.done ? "All guests answered" : "Collecting answers..." }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else :key="`revealed-${currentQuestion.id}`" class="phase-panel">
          <div style="font-size:24px; font-weight:800; margin-bottom:14px;">
            Result: <span data-no-i18n="1">{{ currentQuestion.text }}</span>
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:16px; position:relative;">
            <div v-if="revealedQuestionType==='estimate' && revealedEstimate" class="estimate-panel reveal-card">
              <div class="estimate-header">
                <div style="font-size:24px; font-weight:900; color:#004e96;">Estimate question</div>
                <div style="font-size:16px; opacity:0.85;">Tolerance: ±{{ formatNumber(revealedEstimate.tolerance) }}</div>
              </div>

              <div class="estimate-metrics">
                <div class="estimate-metric estimate-metric--target">
                  <div class="estimate-label">Target value</div>
                  <div class="estimate-value">{{ formatNumber(revealedEstimate.target) }}</div>
                </div>
                <div class="estimate-metric">
                  <div data-no-i18n="1" class="estimate-label">{{ playerName }}</div>
                  <div class="estimate-value">{{ formatNumber(revealedEstimate.playerGuess) }}</div>
                  <div class="estimate-sub">Delta: {{ formatDeltaFromTarget(revealedEstimate.playerGuess) }}</div>
                </div>
                <div class="estimate-metric">
                  <div class="estimate-label">Guests (Median)</div>
                  <div class="estimate-value">{{ formatNumber(revealedEstimate.guestMedian) }}</div>
                  <div class="estimate-sub">Delta: {{ formatDeltaFromTarget(revealedEstimate.guestMedian) }}</div>
                </div>
              </div>

              <div v-if="estimateScale" class="estimate-scale">
                <div class="estimate-scale-labels">
                  <span>{{ formatNumber(estimateScale.min) }}</span>
                  <span>{{ formatNumber(estimateScale.max) }}</span>
                </div>
                <div class="estimate-track">
                  <div class="estimate-tolerance-band"
                       :style="{ left: `${estimateScale.bandStart}%`, width: `${estimateScale.bandWidth}%` }"></div>
                  <div class="estimate-marker estimate-marker--target"
                       :style="{ left: `${estimateScale.targetPct}%` }">
                    <span>Target</span>
                  </div>
                  <div v-if="estimateScale.playerPct !== null" class="estimate-marker estimate-marker--player"
                       :style="{ left: `${estimateScale.playerPct}%` }">
                    <span data-no-i18n="1">{{ playerName }}</span>
                  </div>
                  <div v-if="estimateScale.guestPct !== null" class="estimate-marker estimate-marker--guests"
                       :style="{ left: `${estimateScale.guestPct}%` }">
                    <span>Guests</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-else-if="revealedQuestionType==='order'" class="order-reveal-grid">
              <div class="order-card order-card--correct">
                <div class="order-card-title">{{ t("Correct order") }}</div>
                <ol class="order-list">
                  <li v-for="(item, idx) in correctRevealOrder" :key="`correct-${item.id}-${idx}`" class="order-row"
                      :style="{ animationDelay: `${Math.min(idx, 8) * 70}ms` }">
                    <span class="order-rank">{{ idx + 1 }}</span>
                    <div style="display:grid; gap:8px;">
                      <img v-if="item.image" :src="item.image" alt="Option image"
                           class="clickable-image"
                           @click="openFullscreenImage(item.image)"
                           style="max-width:140px; max-height:80px; object-fit:cover; border:1px solid #ddd; border-radius:8px; background:#fff;" />
                      <span data-no-i18n="1" class="order-text">{{ item.text || "Option" }}</span>
                    </div>
                  </li>
                </ol>
              </div>

              <div v-if="playerOrderRows.length" class="order-card order-card--player">
                <div class="order-card-head">
                  <div class="order-card-title">Answer {{ playerName }}</div>
                </div>
                <ol class="order-list">
                  <li v-for="(row, idx) in playerOrderRows" :key="`${row.id}-${idx}`" class="order-row order-row--player"
                      :style="{ animationDelay: `${120 + Math.min(idx, 8) * 70}ms` }">
                    <span class="order-rank">{{ idx + 1 }}</span>
                    <div style="display:grid; gap:8px;">
                      <img v-if="row.image" :src="row.image" alt="Option image"
                           class="clickable-image"
                           @click="openFullscreenImage(row.image)"
                           style="max-width:140px; max-height:80px; object-fit:cover; border:1px solid #ddd; border-radius:8px; background:#fff;" />
                      <span data-no-i18n="1" class="order-text">{{ row.text || "Option" }}</span>
                    </div>
                  </li>
                </ol>
              </div>
            </div>

            <div v-if="(revealedSolution.type==='text' || revealedSolution.type==='both') && revealedSolution.text"
                 class="reveal-card reveal-card--text"
                 style="padding:16px; border-radius:14px; border:2px solid #004e96; background:#f0f7ff; font-size:20px; line-height:1.4; white-space:pre-wrap;">
              <span data-no-i18n="1">{{ revealedSolution.text }}</span>
            </div>
            <div v-if="(revealedSolution.type==='image' || revealedSolution.type==='both') && revealedSolution.image"
                 class="reveal-card reveal-card--image"
                 style="display:flex; align-items:center; justify-content:center; padding:8px;">
              <img :src="revealedSolution.image" alt="Solution"
                   @click="openFullscreenImage(revealedSolution.image)"
                   class="clickable-image"
                   style="max-height:52vh; max-width:100%; object-fit:contain; border-radius:14px; border:2px solid #004e96; background:#fff;" />
            </div>
            <div v-if="revealedSolution.audio"
                 class="reveal-card"
                 style="padding:12px; border-radius:14px; border:2px solid #004e96; background:#f0f7ff;">
              <audio :src="revealedSolution.audio" controls preload="metadata" style="width:100%;"></audio>
            </div>
            <div v-if="revealedSolution.video"
                 class="reveal-card"
                 style="padding:10px; border-radius:14px; border:2px solid #004e96; background:#f0f7ff;">
              <video :src="revealedSolution.video" controls preload="metadata"
                     style="width:100%; max-height:52vh; border-radius:10px; background:#000;"></video>
            </div>

            <div v-if="showVoteChart"
                 class="reveal-card"
                 style="padding:16px; border-radius:14px; border:2px solid #004e96; background:#f0f7ff;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
                <div style="font-size:14px; font-weight:900; text-transform:uppercase; color:#004e96; letter-spacing:0.05em;">
                  Answer stats
                </div>
                <div v-if="!hasRevealedSolution" style="font-size:14px; font-weight:700; color:#1f2937;">
                  No solution configured for this question.
                </div>
              </div>
              <GuestVoteBars :votes="guestVotes" :playerAnswer="revealedPlayerAnswer" :player-label="playerName" :compact="false" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <transition name="sidebar-slide">
      <div v-if="showSidebar" style="border-left:4px solid #004e96; background:#f9f9f9; padding:18px; display:flex; flex-direction:column; gap:20px; overflow:hidden;">
        <div style="font-size:22px; font-weight:900; margin-bottom:12px; color:#004e96;">Score</div>
        <ScoreBars :score="state.score || {player:0, guests:0}" :playerName="playerName" />
      </div>
    </transition>

    <div v-if="fullscreenImageSrc" class="image-viewer" @click.self="closeFullscreenImage">
      <button @click="closeFullscreenImage" class="image-viewer-close">×</button>
      <img :src="fullscreenImageSrc" alt="Fullscreen" class="image-viewer-img" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import api from "../api.js";
import { getSocket } from "../socket.js";
import ScoreBars from "../components/ScoreBars.vue";
import GuestVoteBars from "../components/GuestVoteBars.vue";
import { resultsImageUrlFromToken, resultsShareUrlFromToken } from "../linkUtils.js";
import { setLanguage, useI18n } from "../i18n.js";

const props = defineProps({ token: String });

const socket = getSocket();
const state = ref({ game: null, questions: [], score: { player: 0, guests: 0 }, player: null });
const { t } = useI18n();
const guestVotes = ref([]);
const revealedPlayerAnswer = ref([]);
const revealedSolution = ref({ type: "none", text: "", image: "", audio: "", video: "" });
const revealedQuestionType = ref("choice");
const revealedEstimate = ref(null);
const shareLink = ref("");
const shareImageUrl = ref("");
const shareMessage = ref("");
const showIntermission = ref(false);
const autoRevealPending = ref(false);
const fullscreenImageSrc = ref("");
let shareLoadedForGameId = null;

const showSidebar = computed(() => state.value.game?.showScore !== false);

const containerStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: showSidebar.value ? "minmax(0, 1fr) 320px" : "minmax(0, 1fr)",
  gap: "0",
  height: "100vh",
  boxSizing: "border-box",
  background: "#fff",
  color: "#333",
  transition: "grid-template-columns 220ms ease"
}));

const contentStyle = {
  padding: "30px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  overflowY: "auto"
};

const currentIndex = computed(() => state.value.game?.currentQuestionIndex ?? 0);
const currentQuestion = computed(() => state.value.questions[currentIndex.value]);
const isLastRevealedQuestion = computed(() => {
  const total = state.value.questions?.length || 0;
  return state.value.game?.status === "live"
    && state.value.game?.phase === "revealed"
    && total > 0
    && currentIndex.value >= total - 1;
});

const playerId = computed(() => state.value.game?.playerId);
const playerName = computed(() => state.value.player?.nickname || state.value.score?.playerName || "Player");
const guestProgress = computed(() => {
  const answered = Number(state.value.progress?.guestAnsweredCount || 0);
  const total = Number(state.value.progress?.guestTotal || state.value.game?.guestCount || 0);
  const pct = total > 0 ? Math.max(0, Math.min(1, answered / total)) : 0;
  return { answered, total, pct, done: total > 0 && answered >= total };
});
const guestPercentLabel = computed(() => `${Math.round((guestProgress.value.pct || 0) * 100)}%`);

function blendColor(a, b, t) {
  const m = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * m);
  const g = Math.round(a[1] + (b[1] - a[1]) * m);
  const b2 = Math.round(a[2] + (b[2] - a[2]) * m);
  return `rgb(${r}, ${g}, ${b2})`;
}

const guestProgressColor = computed(() => {
  const p = guestProgress.value.pct;
  if (p <= 0.5) return blendColor([225, 0, 17], [234, 179, 8], p / 0.5);
  return blendColor([234, 179, 8], [22, 163, 74], (p - 0.5) / 0.5);
});

const playerCircleStyle = computed(() => ({
  width: "100px",
  height: "100px",
  borderRadius: "50%",
  border: playerAnswered.value ? "0" : "4px solid #e10011",
  background: playerAnswered.value ? "#e10011" : "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box"
}));

const guestCircleStyle = computed(() => {
  const deg = Math.round((guestProgress.value.pct || 0) * 360);
  const filled = guestProgress.value.done;
  return {
    width: "100px",
    height: "100px",
    borderRadius: "50%",
    padding: "9px",
    boxSizing: "border-box",
    background: filled
      ? "#16a34a"
      : `conic-gradient(${guestProgressColor.value} ${deg}deg, #e5e7eb ${deg}deg 360deg)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  };
});

const winnerText = computed(() => {
  const g = state.value.game;
  if (!g) return "";
  if (g.winner === "player") return g.playerWinText || "";
  if (g.winner === "guests") return g.guestWinText || "";
  if (g.winner === "tie") return g.tieWinText || "";
  return "";
});

const topRankings = computed(() => (state.value.score?.rankings || []).slice(0, 3));
const optionById = computed(() => {
  return new Map((currentQuestion.value?.options || []).map(o => [String(o.id), {
    text: o.text || `#${o.id}`,
    image: o.image || ""
  }]));
});

function seededRandom(seed) {
  let t = Number(seed || 1) + 0x6D2B79F5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleNeverSame(items, seed = 1) {
  const list = Array.isArray(items) ? [...items] : [];
  if (list.length <= 1) return list;
  const rnd = seededRandom(seed);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const unchanged = list.every((item, idx) => String(item?.id || "") === String(items[idx]?.id || ""));
  if (unchanged) {
    [list[0], list[1]] = [list[1], list[0]];
  }
  return list;
}

const presentedOrderOptions = computed(() => {
  if (String(currentQuestion.value?.type || "") !== "order") return currentQuestion.value?.options || [];
  const base = (currentQuestion.value?.options || []).map(o => ({
    id: o.id,
    text: o.text || "",
    image: o.image || ""
  }));
  return shuffleNeverSame(base, Number(currentQuestion.value?.id || 1) + 101);
});

const correctRevealOrder = computed(() => {
  if (String(revealedQuestionType.value || "") !== "order") return [];
  return (currentQuestion.value?.options || []).map(o => ({
    id: o.id,
    text: o.text || "",
    image: o.image || ""
  }));
});

const playerOrderRows = computed(() => {
  if (!revealedPlayerAnswer.value.length) return [];
  return revealedPlayerAnswer.value.map((id, idx) => ({
    id: String(id),
    text: optionById.value.get(String(id))?.text || `#${id}`,
    image: optionById.value.get(String(id))?.image || ""
  }));
});
const estimateScale = computed(() => {
  const estimate = revealedEstimate.value;
  if (!estimate) return null;

  const target = Number(estimate.target);
  if (!Number.isFinite(target)) return null;

  const tolerance = Math.max(0, Number(estimate.tolerance || 0));
  const playerGuess = Number(estimate.playerGuess);
  const guestMedian = Number(estimate.guestMedian);

  const values = [target, target - tolerance, target + tolerance];
  if (Number.isFinite(playerGuess)) values.push(playerGuess);
  if (Number.isFinite(guestMedian)) values.push(guestMedian);

  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const span = Math.max(1, maxRaw - minRaw);
  const pad = Math.max(span * 0.12, tolerance * 0.35, 1);
  const min = minRaw - pad;
  const max = maxRaw + pad;

  const toPct = (value) => {
    const pct = ((value - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, pct));
  };
  const bandStartRaw = toPct(target - tolerance);
  const bandEndRaw = toPct(target + tolerance);

  return {
    min,
    max,
    targetPct: toPct(target),
    playerPct: Number.isFinite(playerGuess) ? toPct(playerGuess) : null,
    guestPct: Number.isFinite(guestMedian) ? toPct(guestMedian) : null,
    bandStart: Math.min(bandStartRaw, bandEndRaw),
    bandWidth: Math.max(0.8, Math.abs(bandEndRaw - bandStartRaw))
  };
});
const showVoteChart = computed(() => {
  return !["estimate", "order"].includes(String(revealedQuestionType.value || "")) && guestVotes.value.length > 0;
});
const hasRevealedSolution = computed(() => {
  const s = revealedSolution.value || {};
  return !!(String(s.text || "").trim() || s.image || s.audio || s.video);
});

const playerAnswered = ref(false);
let lastQuestionId = null;

function clearIntermission() {
  showIntermission.value = false;
  autoRevealPending.value = false;
}

function startIntermission() {
  if (autoRevealPending.value) return;
  autoRevealPending.value = true;
  showIntermission.value = true;
}

function openFullscreenImage(src) {
  const value = String(src || "").trim();
  if (!value) return;
  fullscreenImageSrc.value = value;
}

function closeFullscreenImage() {
  fullscreenImageSrc.value = "";
}

onMounted(async () => {
  const { data } = await api.get(`/state/${props.token}`);
  state.value.player = data.player;
  if (data?.game?.uiLanguage) {
    await setLanguage(data.game.uiLanguage);
  }

  socket.emit("join_game", { token: props.token });

  socket.on("game_state", (s) => {
    if (s?.game?.uiLanguage) {
      setLanguage(s.game.uiLanguage).catch(() => {});
    }
    state.value = s;
    if (s.game?.status !== "finished") {
      shareLink.value = "";
      shareImageUrl.value = "";
      shareMessage.value = "";
      shareLoadedForGameId = null;
    }
    if (s.questions?.[s.game?.currentQuestionIndex ?? 0]?.id !== lastQuestionId) {
      playerAnswered.value = false;
      lastQuestionId = s.questions?.[s.game?.currentQuestionIndex ?? 0]?.id || null;
    }
    if (s?.progress && typeof s.progress.playerAnswered === "boolean") {
      playerAnswered.value = s.progress.playerAnswered;
    }
    if (s.game?.phase === "answering") {
      guestVotes.value = [];
      revealedPlayerAnswer.value = [];
      revealedSolution.value = { type: "none", text: "", image: "", audio: "", video: "" };
      revealedQuestionType.value = String(currentQuestion.value?.type || "choice");
      revealedEstimate.value = null;
      if (!autoRevealPending.value) showIntermission.value = false;
    } else if (s.game?.phase === "revealed") {
      clearIntermission();
    }
    if (s.game?.status === "finished" && s.game?.id && shareLoadedForGameId !== s.game.id) {
      loadShareInfo();
    }
    if (s.game?.status !== "live") clearIntermission();
  });

  socket.on("reveal", ({ guestVotes: gv, playerAnswer, solution, questionType, estimate }) => {
    revealedPlayerAnswer.value = (playerAnswer || []).map(String);
    revealedSolution.value = {
      type: solution?.type || "none",
      text: solution?.text || "",
      image: solution?.image || "",
      audio: solution?.audio || "",
      video: solution?.video || ""
    };
    revealedQuestionType.value = String(questionType || currentQuestion.value?.type || "choice");
    revealedEstimate.value = estimate || null;
    guestVotes.value = (gv || []).map(v => ({
      id: v.id,
      text: v.text,
      image: v.image || "",
      count: Number(v.count || 0),
      isCorrect: !!v.isCorrect
    }));
  });

  socket.on("answer_received", ({ participantId, questionId }) => {
    if (participantId === playerId.value && currentQuestion.value?.id === questionId) {
      playerAnswered.value = true;
    }
  });

  socket.on("auto_reveal_countdown", () => {
    startIntermission();
  });
});

onBeforeUnmount(() => {
  clearIntermission();
  closeFullscreenImage();
});

function formatNumber(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "-";
  const n = Number(v);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function formatDeltaFromTarget(v) {
  const target = Number(revealedEstimate.value?.target);
  const value = Number(v);
  if (!Number.isFinite(target) || !Number.isFinite(value)) return "-";
  return formatNumber(Math.abs(value - target));
}

async function loadShareInfo() {
  const gameId = state.value.game?.id || null;
  shareMessage.value = "";
  try {
    const { data } = await api.get(`/present/${props.token}/share`);
    const resultToken = String(data?.token || "");
    shareLink.value = resultsShareUrlFromToken(resultToken);
    shareImageUrl.value = resultsImageUrlFromToken(resultToken);
    shareLoadedForGameId = gameId;
  } catch {
    shareLoadedForGameId = gameId;
    shareMessage.value = t("Could not load share link.");
  }
}

async function copyShareLink() {
  if (!shareLink.value) return;
  try {
    await navigator.clipboard.writeText(shareLink.value);
    shareMessage.value = t("Link copied.");
  } catch {
    shareMessage.value = t("Copy failed.");
  }
}

async function reveal() {
  if (autoRevealPending.value) return;
  await api.post(`/present/${props.token}/reveal`);
}

async function next() {
  clearIntermission();
  closeFullscreenImage();
  playerAnswered.value = false;
  await api.post(`/present/${props.token}/next`);
}
</script>

<style scoped>
.clickable-image {
  cursor: zoom-in;
}

.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(2, 6, 23, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.image-viewer-img {
  max-width: min(96vw, 1800px);
  max-height: 92vh;
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
  background: #111827;
}

.image-viewer-close {
  position: fixed;
  top: 14px;
  right: 14px;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(15, 23, 42, 0.7);
  color: #fff;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
}

.show-bumper {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(2, 24, 43, 0.28);
}

.show-bumper-card {
  min-width: 320px;
  max-width: min(84vw, 580px);
  border-radius: 16px;
  border: 2px solid #93c5fd;
  background: #ffffff;
  box-shadow: 0 16px 30px rgba(2, 70, 126, 0.2);
  padding: 18px 24px;
  text-align: center;
  transform: translateZ(0);
  will-change: transform, opacity;
}

.show-bumper-title {
  font-size: 34px;
  font-weight: 900;
  color: #003968;
  letter-spacing: 0.02em;
}

.show-bumper-sub {
  margin-top: 8px;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  opacity: 0.86;
}

.show-bumper-dots {
  margin-top: 14px;
  display: inline-flex;
  gap: 8px;
}

.show-bumper-dots span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #004e96;
  animation: dots-bounce 860ms ease-in-out infinite;
}

.show-bumper-dots span:nth-child(2) {
  animation-delay: 130ms;
}

.show-bumper-dots span:nth-child(3) {
  animation-delay: 260ms;
}

.show-bumper-enter-active,
.show-bumper-leave-active {
  transition: opacity 240ms ease;
}

.show-bumper-enter-from,
.show-bumper-leave-to {
  opacity: 0;
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.phase-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  animation: panel-enter 340ms ease-out;
  will-change: transform, opacity;
}

.phase-chip {
  animation: panel-enter 360ms ease-out;
  will-change: transform, opacity;
}

.question-option {
  animation: row-enter 320ms ease-out both;
  will-change: transform, opacity;
}

.present-option-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.present-option-body.has-media {
  grid-template-columns: 220px minmax(0, 1fr);
}

.present-option-media {
  width: 220px;
  height: 132px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  background: #fff;
}

.present-option-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.present-option-text {
  overflow-wrap: anywhere;
  line-height: 1.25;
}

.progress-card {
  background: linear-gradient(135deg, #ffffff 0%, #f8fbff 100%);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.07);
  animation: panel-enter 360ms ease-out;
  will-change: transform, opacity;
}

.reveal-card {
  box-shadow: 0 12px 28px rgba(2, 70, 126, 0.1);
  animation: panel-enter 360ms ease-out;
  will-change: transform, opacity;
}

.reveal-card--text {
  animation-delay: 80ms;
}

.reveal-card--image {
  animation-delay: 130ms;
}

.estimate-panel {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.estimate-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.estimate-metrics {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.estimate-metric {
  border-radius: 12px;
  border: 1px solid #c9d9ee;
  background: #fff;
  padding: 12px;
}

.estimate-metric--target {
  border-color: #004e96;
  background: linear-gradient(160deg, #ffffff 0%, #e8f2ff 100%);
}

.estimate-label {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #475569;
}

.estimate-value {
  margin-top: 6px;
  font-size: 26px;
  font-weight: 900;
  color: #0f172a;
}

.estimate-sub {
  margin-top: 5px;
  font-size: 14px;
  opacity: 0.86;
}

.estimate-scale {
  display: grid;
  gap: 8px;
}

.estimate-scale-labels {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: #475569;
}

.estimate-track {
  position: relative;
  height: 78px;
  border-radius: 14px;
  border: 1px solid #bfd4ed;
  background: linear-gradient(180deg, #ffffff 0%, #f3f9ff 100%);
  overflow: hidden;
}

.estimate-tolerance-band {
  position: absolute;
  top: 22px;
  height: 34px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.18);
  border: 1px solid rgba(37, 99, 235, 0.25);
}

.estimate-marker {
  position: absolute;
  top: 39px;
  transform: translate(-50%, -50%);
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 3px solid #fff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.25);
  animation: marker-pop 380ms ease-out both;
  will-change: transform, opacity;
}

.estimate-marker span {
  position: absolute;
  left: 50%;
  top: -24px;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #0f172a;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #d6e3f5;
  border-radius: 999px;
  padding: 2px 7px;
}

.estimate-marker--target {
  background: #004e96;
}

.estimate-marker--player {
  background: #e10011;
}

.estimate-marker--guests {
  background: #16a34a;
}

.order-reveal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}

.order-card {
  border-radius: 14px;
  padding: 14px;
  background: #fff;
  border: 1px solid #d0dceb;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
  animation: panel-enter 340ms ease-out;
  will-change: transform, opacity;
}

.order-card--correct {
  border-color: #004e96;
  background: linear-gradient(180deg, #eef6ff 0%, #ffffff 100%);
}

.order-card--player {
  border-color: #cfd8e3;
}

.order-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  align-items: baseline;
}

.order-card-title {
  font-size: 18px;
  font-weight: 900;
  color: #0f172a;
  margin-bottom: 8px;
}

.order-score {
  font-size: 13px;
  font-weight: 900;
  color: #0f766e;
  background: #ecfeff;
  border: 1px solid #99f6e4;
  border-radius: 999px;
  padding: 4px 10px;
}

.order-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.order-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 11px;
  border: 1px solid #d5dfec;
  background: #ffffffcc;
  padding: 10px 12px;
  animation: row-enter 320ms ease-out both;
  will-change: transform, opacity;
}

.order-row--player.is-match {
  border-color: #16a34a;
  background: #f0fdf4;
}

.order-row--player.is-miss {
  border-color: #fca5a5;
  background: #fff5f5;
}

.order-rank {
  min-width: 28px;
  height: 28px;
  border-radius: 999px;
  background: #004e96;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 900;
}

.order-text {
  flex: 1;
  font-size: 18px;
  font-weight: 700;
}

.order-status {
  font-size: 18px;
  font-weight: 900;
}

@media (max-width: 900px) {
  .present-option-body.has-media {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .present-option-media {
    width: 100%;
    height: 190px;
  }
}

@keyframes panel-enter {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes row-enter {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes marker-pop {
  from {
    opacity: 0;
    transform: translate(-50%, -12px) scale(0.7);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes dots-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  40% {
    transform: translateY(-7px);
    opacity: 1;
  }
}
</style>
