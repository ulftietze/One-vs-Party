<template>
  <div style="max-width:900px; margin:30px auto; padding:0 16px;">
    <h1 style="margin:0 0 8px;">Async</h1>

    <div v-if="!participantId" style="border:1px solid #eee; border-radius:14px; padding:16px;">
      <div style="font-weight:800; margin-bottom:10px;">Enter name</div>
      <input v-model="nickname" placeholder="Your name"
             style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid #ddd;" />
      <button @click="join"
              style="margin-top:10px; padding:10px 12px; border-radius:12px; border:0; background:#004e96; color:#fff; font-weight:800;">
        Start
      </button>
      <div v-if="joinError" style="margin-top:8px; color:#e10011; font-weight:700;">{{ joinError }}</div>
    </div>

    <div v-else>
      <div style="opacity:0.75; margin-bottom:12px;">
        {{ t("Game: {title} · Questions: {count}", { title: state.game?.title || "", count: state.questions.length }) }}
      </div>

      <div v-if="state.game?.status === 'setup'" style="margin-bottom:12px; padding:10px 12px; border:1px solid #c7d2fe; border-radius:10px; background:#eef2ff; color:#1e3a8a; font-weight:700;">
        You can submit answers before the game starts. Changes are possible until reveal.
      </div>

      <template v-if="state.game?.status !== 'finished' && state.questions.length > 0">
        <div style="display:grid; gap:14px;">
          <div v-for="(question, i) in state.questions" :key="question.id">
            <div style="font-weight:900; margin-bottom:6px;">{{ t("Question {index}", { index: i + 1 }) }}</div>
            <QuestionCard
              :question="question"
              :disabled="isQuestionLocked(i)"
              :selected-option-ids="selectionFor(question.id)"
              :show-media="state.game?.showParticipantMedia !== false"
              :hint="answerHint(question.id, i)"
              @submit="(ids) => submit(question.id, ids)"
            />
          </div>
        </div>
      </template>

      <div v-else-if="state.game?.status === 'finished'" style="text-align:center; padding:40px 20px;">
        <div style="font-size:24px; font-weight:900; color:#004e96; margin-bottom:20px;">Game finished!</div>
        <div style="font-size:18px; opacity:0.8;">Thanks for playing!</div>

        <div v-if="myRanking" style="margin-top:14px; padding:20px; border:2px solid #004e96; border-radius:16px; background:#f0f7ff;">
          <div style="font-size:20px; font-weight:800; color:#004e96;">{{ myRanking.text }}</div>
          <div style="font-size:16px; opacity:0.8; margin-top:8px;">
            {{ t("Correct answers: {score} of {total}", { score: myRanking.score, total: state.questions.length }) }}
          </div>
        </div>

        <div v-if="personalShare.url" style="margin-top:14px; padding:14px; border:1px solid #dbeafe; border-radius:14px; background:#eff6ff;">
          <div style="font-weight:900; color:#1d4ed8; margin-bottom:8px;">Your personal result card</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
            <button @click="copyPersonalShareLink"
                    style="padding:10px 12px; border-radius:10px; border:0; background:#1d4ed8; color:#fff; font-weight:800; cursor:pointer;">
              Copy link
            </button>
            <a :href="personalShare.url"
               style="padding:10px 12px; border-radius:10px; border:1px solid #1d4ed8; background:#fff; color:#1d4ed8; text-decoration:none; font-weight:800;">
              Open card
            </a>
            <a :href="personalShare.imageUrl" target="_blank"
               style="padding:10px 12px; border-radius:10px; border:1px solid #1d4ed8; background:#fff; color:#1d4ed8; text-decoration:none; font-weight:800;">
              Open PNG
            </a>
          </div>
          <div v-if="personalShareMsg" style="margin-top:8px; font-size:13px; opacity:0.78;">{{ personalShareMsg }}</div>
        </div>
      </div>

      <div v-else style="text-align:center; padding:40px 20px; opacity:0.8;">
        <div style="font-size:20px; font-weight:700;">Questions are being prepared</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import api from "../api.js";
import { getSocket } from "../socket.js";
import QuestionCard from "../components/QuestionCard.vue";
import { resultsImageUrlFromToken, resultsShareUrlFromToken } from "../linkUtils.js";
import { setLanguage, useI18n } from "../i18n.js";

const props = defineProps({ token: String });

const socket = getSocket();
const state = ref({ game: null, questions: [], score: { player: 0, guests: 0 } });
const { t } = useI18n();

const participantId = ref(localStorage.getItem(`participantId_${props.token}`) || null);
const nickname = ref(localStorage.getItem(`nickname_${props.token}`) || "");
const clientKeyStorageKey = `guestClientKey_${props.token}`;
const clientKey = ref(localStorage.getItem(clientKeyStorageKey) || "");

const answersByQuestion = ref({});
const joinedAt = ref(Date.now());
const joinError = ref("");
const personalShare = ref({ url: "", imageUrl: "" });
const personalShareMsg = ref("");
const personalShareLoaded = ref(false);

function makeClientKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `g_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

if (!clientKey.value) {
  clientKey.value = makeClientKey();
  localStorage.setItem(clientKeyStorageKey, clientKey.value);
}

function isQuestionLocked(questionIndex) {
  if (state.value.game?.status === "finished") return true;
  if (state.value.game?.status !== "live") return false;
  const revealed = Number(state.value.game?.revealedQuestionIndex ?? -1);
  return revealed >= questionIndex;
}

function answerHint(questionId, questionIndex) {
  if (isQuestionLocked(questionIndex)) return t("Revealed. Answer is locked.");
  if (state.value.game?.status === "setup" && selectionFor(questionId).length) return t("Saved for start.");
  if (selectionFor(questionId).length) return t("Saved. You can edit until reveal.");
  return "";
}

function selectionFor(questionId) {
  return answersByQuestion.value[String(questionId)] || [];
}

const myRanking = computed(() => {
  if (!participantId.value || !state.value.score?.rankings) return null;
  const rankings = state.value.score.rankings;
  const idx = rankings.findIndex(r => r.id === Number(participantId.value));
  if (idx === -1) return null;
  const total = rankings.length;
  const rank = idx + 1;
  const score = rankings[idx].score;
  return {
    rank,
    score,
    text: rank === 1
      ? t("You know {playerName} best. Rank {rank} of {total}.", {
        playerName: state.value.player?.nickname || t("the player"),
        rank,
        total
      })
      : t("Rank {rank} of {total}.", { rank, total })
  };
});

onMounted(async () => {
  const initial = await api.get(`/state/${props.token}`).catch(() => ({ data: null }));
  if (initial?.data?.game?.uiLanguage) {
    await setLanguage(initial.data.game.uiLanguage);
  }

  socket.emit("join_game", { token: props.token });
  socket.on("game_state", (s) => {
    if (s?.game?.uiLanguage) {
      setLanguage(s.game.uiLanguage).catch(() => {});
    }
    // Nur bei explizitem Reset/Stop (Setup + neuem Zeitstempel) Gastzustand löschen
    if (s.game?.status === "setup" && s.game?.lastStartedAt) {
      const startT = new Date(s.game.lastStartedAt).getTime();
      if (startT > joinedAt.value) {
        participantId.value = null;
        nickname.value = "";
        localStorage.removeItem(`participantId_${props.token}`);
        localStorage.removeItem(`nickname_${props.token}`);
        joinedAt.value = Date.now();
        answersByQuestion.value = {};
      }
    }

    state.value = s;
    state.value.questions = (s.questions || []).map(q => ({
      id: q.id,
      text: q.text,
      type: q.type || "choice",
      allowMultiple: q.allowMultiple,
      promptImage: q.promptImage || "",
      promptAudio: q.promptAudio || "",
      promptVideo: q.promptVideo || "",
      options: q.options
    }));

    if (s.game?.status === "finished" && participantId.value && !personalShareLoaded.value) {
      loadPersonalShare().catch(() => {});
    }
    if (s.game?.status !== "finished") {
      personalShareLoaded.value = false;
      personalShare.value = { url: "", imageUrl: "" };
      personalShareMsg.value = "";
    }
  });

  if (participantId.value) {
    try {
      const { data } = await api.post(`/join/${props.token}`, { 
        participantId: participantId.value,
        nickname: nickname.value,
        clientKey: clientKey.value
      });
      participantId.value = data.participantId;
      nickname.value = data.nickname;
    } catch (e) {
      participantId.value = null;
      nickname.value = "";
      localStorage.removeItem(`participantId_${props.token}`);
      localStorage.removeItem(`nickname_${props.token}`);
    }
  }
});

async function join() {
  const cleanName = (nickname.value || "").trim();
  if (!cleanName) {
    joinError.value = t("Please enter a name.");
    return;
  }
  const { data } = await api.post(`/join/${props.token}`, { nickname: cleanName, clientKey: clientKey.value });
  participantId.value = data.participantId;
  nickname.value = data.nickname;
  localStorage.setItem(`participantId_${props.token}`, data.participantId);
  localStorage.setItem(`nickname_${props.token}`, data.nickname);
  joinError.value = "";
}

async function submit(questionId, optionIds) {
  if (!participantId.value) return;
  await api.post(`/answer/${props.token}`, {
    participantId: participantId.value,
    questionId,
    optionIds
  });
  answersByQuestion.value = {
    ...answersByQuestion.value,
    [String(questionId)]: (optionIds || []).map(String)
  };
}

async function loadPersonalShare() {
  if (!participantId.value) return;
  const { data } = await api.get(`/guest/${props.token}/personal-share`, {
    params: { participantId: participantId.value }
  }).catch(e => ({ data: { error: e?.response?.data?.error || "error" } }));
  if (data?.resultToken) {
    const pid = Number(data?.participantId || participantId.value || 0);
    personalShare.value = {
      url: resultsShareUrlFromToken(data.resultToken, pid),
      imageUrl: resultsImageUrlFromToken(data.resultToken, pid)
    };
    personalShareLoaded.value = true;
    personalShareMsg.value = "";
    return;
  }
  personalShareLoaded.value = true;
  personalShareMsg.value = t("Could not load personal card.");
}

async function copyPersonalShareLink() {
  const url = personalShare.value?.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    personalShareMsg.value = t("Link copied.");
  } catch {
    personalShareMsg.value = t("Copy failed.");
  }
}
</script>
