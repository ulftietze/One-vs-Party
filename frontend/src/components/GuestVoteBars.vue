<template>
  <div v-if="normalizedVotes.length" :class="['vote-list', compact ? 'vote-list--compact' : 'vote-list--full']">
    <article v-for="v in normalizedVotes" :key="v.id" class="vote-card">
      <div class="vote-row vote-row--top">
        <div class="vote-option">
          <img v-if="v.image" :src="v.image" alt="Option image" class="vote-thumb" />
          <div data-no-i18n="1" class="vote-text">{{ v.text || `#${v.id}` }}</div>
        </div>
        <div class="vote-meta">
          <span v-if="v.playerSelected" data-no-i18n="1" class="vote-badge vote-badge--player">{{ playerLabel }}</span>
          <span v-if="v.isCorrect" class="vote-badge vote-badge--correct">✓</span>
          <span class="vote-count">{{ v.count }}</span>
        </div>
      </div>

      <div class="vote-track">
        <div class="vote-fill" :class="{ 'is-correct': v.isCorrect }" :style="{ width: `${v.pct}%` }"></div>
      </div>
    </article>
  </div>
  <div v-else class="vote-empty">No guest answers yet.</div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  votes: { type: Array, default: () => [] },
  playerAnswer: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
  playerLabel: { type: String, default: "Player" }
});

const compact = computed(() => !!props.compact);
const maxCount = computed(() => Math.max(1, ...(props.votes || []).map(v => Number(v?.count || 0))));
const normalizedVotes = computed(() => {
  const selected = new Set((props.playerAnswer || []).map(String));
  return (props.votes || []).map(v => {
    const count = Number(v?.count || 0);
    const pct = Math.max(0, Math.min(100, Math.round((count / maxCount.value) * 100)));
    return {
      id: v?.id,
      text: String(v?.text || ""),
      image: String(v?.image || ""),
      isCorrect: !!v?.isCorrect,
      playerSelected: selected.has(String(v?.id)),
      count,
      pct
    };
  }).sort((a, b) => b.count - a.count);
});
</script>

<style scoped>
.vote-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.vote-list--full {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.vote-list--compact {
  grid-template-columns: 1fr;
}

.vote-card {
  border: 1px solid #d7e4f3;
  border-radius: 12px;
  background: #fff;
  padding: 10px;
  display: grid;
  gap: 10px;
}

.vote-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.vote-option {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.vote-thumb {
  width: 58px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid #d1d5db;
  background: #fff;
  flex: 0 0 auto;
}

.vote-text {
  min-width: 0;
  font-weight: 800;
  line-height: 1.2;
  color: #0f172a;
  font-size: 14px;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.vote-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.vote-badge {
  border-radius: 999px;
  padding: 2px 8px;
  font-weight: 900;
  font-size: 11px;
  line-height: 1.3;
  border: 1px solid transparent;
}

.vote-badge--player {
  color: #b91c1c;
  border-color: #fca5a5;
  background: #fff1f2;
}

.vote-badge--correct {
  color: #0f766e;
  border-color: #99f6e4;
  background: #f0fdfa;
  padding: 2px 7px;
}

.vote-count {
  min-width: 32px;
  text-align: right;
  color: #0f172a;
  font-size: 15px;
  font-weight: 900;
}

.vote-track {
  height: 11px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
}

.vote-fill {
  height: 100%;
  border-radius: 999px;
  background: #1e3a8a;
  transition: width 350ms ease;
}

.vote-fill.is-correct {
  background: #004e96;
}

.vote-empty {
  opacity: 0.75;
  font-size: 16px;
  text-align: center;
}

.vote-list--compact .vote-card {
  padding: 8px;
  gap: 8px;
}

.vote-list--compact .vote-text {
  font-size: 12px;
  -webkit-line-clamp: 2;
}

.vote-list--compact .vote-thumb {
  width: 44px;
  height: 34px;
}

.vote-list--compact .vote-count {
  font-size: 13px;
}

.vote-list--compact .vote-badge {
  font-size: 10px;
}
</style>
