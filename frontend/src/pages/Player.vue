<template>
  <div style="max-width:900px; margin:30px auto; padding:0 16px;">
    <h1 style="margin:0 0 8px;">{{ playerName || "You" }}</h1>

    <div v-if="!state.game?.isPublished" style="text-align:center; padding:40px 20px; opacity:0.85;">
      <div style="font-size:24px; font-weight:900; color:#004e96; margin-bottom:12px;">Coming soon</div>
    </div>

    <div v-else-if="state.game?.status === 'setup'" style="text-align:center; padding:40px 20px; opacity:0.85;">
      <div style="font-size:24px; font-weight:900; color:#004e96; margin-bottom:12px;">Waiting for game start</div>
      <div style="font-size:14px;">You can answer once the admin starts the game.</div>
    </div>

    <template v-else>
      <div style="opacity:0.75; margin-bottom:12px;">
        {{ t("Game: {title} · Question {current} / {total}", {
          title: state.game?.title || "",
          current: idx + 1,
          total: state.questions.length
        }) }}
      </div>

      <QuestionCard v-if="q"
                    :question="q"
                    :disabled="answerLocked"
                    :selected-option-ids="currentSelection"
                    :show-media="state.game?.showParticipantMedia !== false"
                    :hint="answerHint"
                    @submit="submit" />

      <div v-else style="opacity:0.75;">Waiting for questions…</div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import api from "../api.js";
import { getSocket } from "../socket.js";
import QuestionCard from "../components/QuestionCard.vue";
import { setLanguage, useI18n } from "../i18n.js";

const props = defineProps({ token: String });

const socket = getSocket();
const state = ref({ game: null, questions: [], score: { player: 0, guests: 0 }, player: null });
const { t } = useI18n();

const participantId = ref(null);
const playerName = computed(() => state.value.player?.nickname || "Player");

const idx = computed(() => state.value.game?.currentQuestionIndex ?? 0);
const q = computed(() => state.value.questions[idx.value]);
const answersByQuestion = ref({});
const currentSelection = computed(() => {
  const qid = q.value?.id;
  if (!qid) return [];
  return answersByQuestion.value[String(qid)] || [];
});
const answerLocked = computed(() => state.value.game?.phase === "revealed" || state.value.game?.status !== "live");
const answerHint = computed(() => {
  if (answerLocked.value) return t("Reveal in progress. Answer is locked now.");
  if (currentSelection.value.length) return t("Answer saved. You can edit until reveal.");
  return "";
});

function normalizeQuestion(question) {
  const source = question || {};
  const optionsSource = Array.isArray(source.options)
    ? source.options
    : Array.isArray(source.Options)
      ? source.Options
      : [];
  return {
    id: source.id,
    text: String(source.text || ""),
    type: String(source.type || "choice"),
    allowMultiple: !!source.allowMultiple,
    promptImage: String(source.promptImage || ""),
    promptAudio: String(source.promptAudio || ""),
    promptVideo: String(source.promptVideo || ""),
    options: optionsSource.map((o) => ({
      id: o?.id,
      text: String(o?.text || ""),
      image: String(o?.image || "")
    }))
  };
}

function normalizeStatePayload(raw) {
  const source = raw || {};
  return {
    game: source.game || null,
    player: source.player || null,
    questions: Array.isArray(source.questions) ? source.questions.map(normalizeQuestion) : [],
    score: source.score || { player: 0, guests: 0 },
    progress: source.progress || {
      guestAnsweredCount: 0,
      guestTotal: Number(source?.game?.guestCount || 0),
      playerAnswered: false,
      playerSelection: []
    }
  };
}

function setSelection(questionId, optionIds) {
  if (!questionId) return;
  answersByQuestion.value = {
    ...answersByQuestion.value,
    [String(questionId)]: (optionIds || []).map(String)
  };
}

onMounted(async () => {
  const initial = await api.get(`/state/${props.token}`).catch(() => ({ data: null }));
  if (initial?.data) {
    state.value = normalizeStatePayload(initial.data);
  }
  if (initial?.data?.game?.uiLanguage) {
    await setLanguage(initial.data.game.uiLanguage);
  }

  socket.emit("join_game", { token: props.token });

  socket.on("game_state", (s) => {
    const nextState = normalizeStatePayload(s);
    if (s?.game?.uiLanguage) {
      setLanguage(s.game.uiLanguage).catch(() => {});
    }
    state.value = nextState;
    const currentQid = nextState.questions?.[nextState.game?.currentQuestionIndex ?? 0]?.id;
    if (currentQid && Array.isArray(s?.progress?.playerSelection)) {
      setSelection(currentQid, s.progress.playerSelection);
    }
  });

  // Player ist im Spiel bereits festgelegt: automatisch joinen
  const { data } = await api.post(`/join/${props.token}`, {});
  participantId.value = data.participantId;

  const afterJoin = await api.get(`/state/${props.token}`).catch(() => ({ data: null }));
  if (afterJoin?.data) {
    state.value = normalizeStatePayload(afterJoin.data);
  }
  if (afterJoin?.data?.game?.uiLanguage) {
    await setLanguage(afterJoin.data.game.uiLanguage);
  }
});

async function submit(optionIds) {
  if (!participantId.value || !q.value) return;
  await api.post(`/answer/${props.token}`, {
    participantId: participantId.value,
    questionId: q.value.id,
    optionIds
  });
  setSelection(q.value.id, optionIds);
}
</script>
