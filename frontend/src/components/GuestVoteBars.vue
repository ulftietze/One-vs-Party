<template>
  <div v-if="items.length" :class="['vote-root', { 'variant-modal': variant === 'modal' }]">
    <div v-if="resolvedMode === 'mini'" class="mini-list">
      <div v-for="item in miniItems" :key="item.id"
           :class="['mini-row', { 'is-player': item.playerSelected, 'is-correct': item.isCorrect }]"
           :title="item.text">
        <span class="mini-letter">{{ item.letter }}</span>
        <div class="mini-track">
          <div class="mini-fill" :class="{ 'is-correct': item.isCorrect }" :style="{ width: `${item.pct}%` }"></div>
        </div>
        <span class="mini-count">{{ item.count }}</span>
      </div>
    </div>

    <div v-else-if="resolvedMode === 'bubble'" class="bubble-shell">
      <div :class="['bubble-grid', { 'bubble-grid--dense': items.length > 4 }]"
           :style="{ '--bubble-cols': bubbleColumns }">
        <div v-for="(item, idx) in items" :key="`bubble-${item.id}-${item.totalPct}-${item.count}`"
             :class="['bubble-slot', `is-${bubblePercentPlacement(idx)}`, { 'is-correct': item.isCorrect }]"
             :style="{ '--bubble-pct': `${item.renderPct}%`, '--bubble-i': idx }">
          <article :class="['bubble-card', { 'is-correct': item.isCorrect, 'is-player': item.playerSelected }]">
            <div class="bubble-head">
              <div class="bubble-head-left">
                <span class="bubble-letter">{{ item.letter }}</span>
                <span v-if="item.playerSelected" data-no-i18n="1" class="bubble-flag bubble-flag--player">{{ playerLabel }}</span>
                <span v-if="item.isCorrect" class="bubble-flag bubble-flag--correct">✓</span>
              </div>
            </div>
            <div class="bubble-body">
              <img v-if="item.image" :src="item.image" alt="Option image" class="bubble-thumb" />
              <span data-no-i18n="1" :class="['bubble-text', { 'bubble-text--long': String(item.text || '').length > 42 }]">
                {{ item.text || `#${item.id}` }}
              </span>
            </div>
          </article>
          <span :class="['bubble-percent', `bubble-percent--${bubblePercentPlacement(idx)}`]">{{ item.totalPct }}%</span>
        </div>
      </div>
    </div>

    <div v-else class="vertical-shell">
      <div class="vertical-bars">
        <div v-for="item in items" :key="item.id" :class="['vertical-col', { 'is-correct': item.isCorrect }]">
          <div class="vertical-count">{{ item.count }}</div>
          <div :class="['vertical-track', { 'is-correct': item.isCorrect }]">
            <div class="vertical-fill"
                 :class="{ 'is-correct': item.isCorrect, 'is-player': item.playerSelected }"
                 :style="{ height: `${item.heightPct}%` }"></div>
          </div>
          <div class="vertical-meta">
            <span class="vertical-letter">{{ item.letter }}</span>
            <span v-if="item.playerSelected" data-no-i18n="1" class="vertical-badge vertical-badge--player">{{ playerLabel }}</span>
            <span v-if="item.isCorrect" class="vertical-badge vertical-badge--correct">✓</span>
          </div>
        </div>
      </div>

      <div class="vertical-legend">
        <div v-for="item in items" :key="`legend-${item.id}`" :class="['legend-row', { 'is-correct': item.isCorrect }]">
          <span class="legend-letter">{{ item.letter }}</span>
          <img v-if="item.image" :src="item.image" alt="Option image" class="legend-thumb" />
          <span data-no-i18n="1" class="legend-text">{{ item.text || `#${item.id}` }}</span>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="empty-state">No guest answers yet.</div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  votes: { type: Array, default: () => [] },
  playerAnswer: { type: Array, default: () => [] },
  playerLabel: { type: String, default: "Player" },
  compact: { type: Boolean, default: false },
  mode: { type: String, default: "" },
  variant: { type: String, default: "default" },
  maxItems: { type: Number, default: 0 }
});

const resolvedMode = computed(() => {
  const value = String(props.mode || "").trim().toLowerCase();
  if (value === "mini" || value === "vertical" || value === "bubble") return value;
  return props.compact ? "mini" : "vertical";
});

function letterFor(index) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < alphabet.length) return alphabet[index];
  const base = alphabet[index % alphabet.length];
  const suffix = Math.floor(index / alphabet.length) + 1;
  return `${base}${suffix}`;
}

const maxCount = computed(() => Math.max(1, ...(props.votes || []).map(v => {
  const count = Number(v?.count || 0);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
})));
const totalCount = computed(() => Math.max(0, (props.votes || []).reduce((sum, v) => {
  const count = Number(v?.count || 0);
  return sum + (Number.isFinite(count) ? Math.max(0, count) : 0);
}, 0)));
const items = computed(() => {
  const selected = new Set((props.playerAnswer || []).map(String));
  return (props.votes || []).map((v, idx) => {
    const rawCount = Number(v?.count || 0);
    const count = Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;
    const pct = Math.max(0, Math.min(100, Math.round((count / maxCount.value) * 100)));
    const totalPct = totalCount.value > 0
      ? Math.max(0, Math.min(100, Math.round((count / totalCount.value) * 100)))
      : 0;
    const minVisiblePct = count > 0 ? 12 : 0;
    return {
      id: v?.id,
      letter: letterFor(idx),
      text: String(v?.text || ""),
      image: String(v?.image || ""),
      count,
      pct,
      totalPct,
      renderPct: count > 0 ? Math.max(2, totalPct) : 0,
      heightPct: Math.max(minVisiblePct, pct),
      isCorrect: !!v?.isCorrect,
      playerSelected: selected.has(String(v?.id))
    };
  });
});

const miniItems = computed(() => {
  const maxItems = Number(props.maxItems || 0);
  if (!Number.isFinite(maxItems) || maxItems <= 0) return items.value;
  return items.value.slice(0, Math.floor(maxItems));
});

const bubbleColumns = computed(() => {
  const count = items.value.length;
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  if (count === 4) return 2;
  if (count <= 6) return 3;
  return 4;
});

const bubbleRows = computed(() => Math.max(1, Math.ceil(items.value.length / bubbleColumns.value)));

function bubblePercentPlacement(index) {
  if (items.value.length !== 4) return "top";
  if (bubbleRows.value <= 1) return "top";
  const row = Math.floor(index / bubbleColumns.value);
  if (row === 0) return "top";
  if (row === bubbleRows.value - 1) return "bottom";
  return "top";
}
</script>

<style scoped>
.empty-state {
  opacity: 0.75;
  font-size: 16px;
  text-align: center;
}

.mini-list {
  display: grid;
  gap: 8px;
}

.mini-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  border: 1px solid #d7e4f3;
  border-radius: 8px;
  background: #fff;
  padding: 4px 6px;
}

.mini-letter {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 900;
  background: #1e3a8a;
  color: #fff;
}

.mini-track {
  height: 6px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
}

.mini-fill {
  height: 100%;
  border-radius: 999px;
  background: #1e3a8a;
  transition: width 320ms ease;
}

.mini-fill.is-correct {
  background: #004e96;
}

.mini-count {
  min-width: 16px;
  text-align: right;
  font-size: 11px;
  font-weight: 900;
  color: #0f172a;
}

.mini-row.is-player {
  border-color: #fecaca;
  background: #fff8f8;
}

.mini-row.is-correct {
  border-color: #22c55e;
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.35);
}

.bubble-shell {
  display: grid;
  gap: 12px;
}

.bubble-grid {
  --bubble-gap: 20px;
  display: grid;
  width: 100%;
  max-width: calc((var(--bubble-cols, 2) * 320px) + ((var(--bubble-cols, 2) - 1) * var(--bubble-gap)));
  margin: 0 auto;
  grid-template-columns: repeat(var(--bubble-cols, 2), minmax(0, 1fr));
  column-gap: var(--bubble-gap);
  row-gap: 22px;
}

.bubble-grid--dense {
  --bubble-gap: 16px;
  row-gap: 20px;
}

.bubble-grid--dense .bubble-card {
  min-height: 100%;
  padding: 10px;
}

.bubble-grid--dense .bubble-letter {
  width: 26px;
  height: 26px;
  font-size: 12px;
}

.bubble-grid--dense .bubble-percent {
  font-size: 14px;
  padding: 4px 10px;
}

.bubble-grid--dense .bubble-text {
  font-size: clamp(14px, 1.1vw, 22px);
  -webkit-line-clamp: 2;
}

.bubble-grid--dense .bubble-thumb {
  width: min(82%, 112px);
  height: 64px;
}

.bubble-slot {
  position: relative;
  overflow: visible;
  min-height: 172px;
  min-width: 0;
  padding: 2px 4px;
  box-sizing: border-box;
}

.bubble-slot.is-correct {
  border-radius: 26px;
}

.bubble-slot.is-top {
  padding-top: 0;
}

.bubble-slot.is-bottom {
  padding-bottom: 0;
}

.bubble-card {
  min-height: 100%;
  width: auto;
  margin: 0;
  border-radius: 24px;
  border: 1px solid #7fa1df;
  background: linear-gradient(165deg, #1f3688 0%, #2343a6 100%);
  color: #eff6ff;
  padding: 12px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 6px;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.16);
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.bubble-card::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 0;
  background: linear-gradient(180deg, #6ea9dc 0%, #84bae6 100%);
  animation: bubble-fill-rise 560ms cubic-bezier(0.2, 0.65, 0.2, 1) forwards;
  animation-delay: calc(140ms + (40ms * var(--bubble-i, 0)));
  z-index: 0;
}

.bubble-card > * {
  position: relative;
  z-index: 1;
}

.bubble-card.is-correct {
  border-width: 2px;
  border-color: #22c55e;
  box-shadow: 0 14px 24px rgba(15, 23, 42, 0.18);
}

.bubble-card.is-player {
  box-shadow: 0 14px 24px rgba(15, 23, 42, 0.18);
}

.bubble-card.is-correct::before {
  background: linear-gradient(180deg, #10b981 0%, #059669 100%);
}

.bubble-head {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 8px;
}

.bubble-head-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.bubble-letter {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 900;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.bubble-flag {
  min-width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  border: 1px solid transparent;
}

.bubble-flag--player {
  background: rgba(255, 241, 242, 0.95);
  color: #be123c;
  border-color: rgba(251, 113, 133, 0.7);
  max-width: 220px;
  min-height: 24px;
  white-space: normal;
  text-align: center;
  line-height: 1.05;
  padding-top: 3px;
  padding-bottom: 3px;
}

.bubble-flag--correct {
  background: rgba(220, 252, 231, 0.95);
  color: #166534;
  border-color: rgba(74, 222, 128, 0.7);
}

.bubble-percent {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 16px;
  font-weight: 900;
  background: #fff;
  color: #1e3a8a;
  line-height: 1;
  box-shadow: 0 2px 6px rgba(2, 6, 23, 0.18);
  z-index: 2;
  opacity: 0;
  animation: bubble-chip-in 220ms ease-out forwards;
  animation-delay: calc(20ms + (40ms * var(--bubble-i, 0)));
}

.bubble-percent::after {
  content: "";
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.bubble-percent--top {
  top: -12px;
}

.bubble-percent--top::after {
  bottom: -6px;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid #fff;
}

.bubble-percent--bottom {
  bottom: -12px;
}

.bubble-percent--bottom::after {
  top: -6px;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid #fff;
}

.bubble-body {
  min-height: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
  text-align: center;
  padding: 0 10px;
}

.bubble-thumb {
  width: min(88%, 140px);
  height: 84px;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.58);
  background: rgba(255, 255, 255, 0.28);
  box-shadow: 0 6px 14px rgba(2, 6, 23, 0.28);
}

.bubble-text {
  font-size: clamp(18px, 1.75vw, 32px);
  font-weight: 900;
  line-height: 1.1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-wrap: balance;
  text-shadow: 0 2px 6px rgba(2, 6, 23, 0.58);
  max-width: 100%;
}

.bubble-text--long {
  font-size: clamp(15px, 1.2vw, 24px);
  -webkit-line-clamp: 2;
  -webkit-mask-image: linear-gradient(180deg, #000 70%, rgba(0, 0, 0, 0.08) 100%);
  mask-image: linear-gradient(180deg, #000 70%, rgba(0, 0, 0, 0.08) 100%);
}

.bubble-grid--dense .bubble-slot {
  min-height: 142px;
}

.vertical-shell {
  display: grid;
  gap: 14px;
}

.vertical-bars {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 10px;
  align-items: stretch;
  min-height: 250px;
}

.vertical-col {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: stretch;
  min-height: 0;
}

.vertical-count {
  text-align: center;
  font-size: 16px;
  font-weight: 900;
  color: #0f172a;
}

.vertical-track {
  min-height: 170px;
  height: 100%;
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  border: 1px solid #d7e4f3;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
  padding: 8px 6px 4px;
}

.vertical-track.is-correct {
  border-color: #22c55e;
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.28);
}

.vertical-fill {
  width: min(80%, 66px);
  border-radius: 9px 9px 4px 4px;
  background: linear-gradient(180deg, #1e3a8a 0%, #1e40af 100%);
  transition: height 350ms ease;
}

.vertical-fill.is-correct {
  background: linear-gradient(180deg, #004e96 0%, #1d4ed8 100%);
}

.vertical-fill.is-player {
  box-shadow: inset 0 0 0 3px #ef4444;
}

.vertical-track::after {
  content: "";
  position: absolute;
  left: 12%;
  right: 12%;
  bottom: 3px;
  height: 2px;
  border-radius: 999px;
  background: #93c5fd;
}

.vertical-meta {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.vertical-letter {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 900;
  background: #1e3a8a;
  color: #fff;
}

.vertical-badge {
  border-radius: 999px;
  border: 1px solid transparent;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.vertical-badge--player {
  color: #b91c1c;
  border-color: #fca5a5;
  background: #fff1f2;
  white-space: normal;
  text-align: center;
  line-height: 1.1;
}

.vertical-badge--correct {
  color: #0f766e;
  border-color: #99f6e4;
  background: #f0fdfa;
}

.vertical-legend {
  display: grid;
  gap: 8px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #d7e4f3;
  border-radius: 10px;
  background: #fff;
  padding: 8px 10px;
}

.legend-row.is-correct {
  border-color: #22c55e;
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.32);
  background: linear-gradient(180deg, #f4fff7 0%, #ecfdf3 100%);
}

.legend-letter {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  background: #1e3a8a;
  color: #fff;
  flex: 0 0 auto;
}

.legend-thumb {
  width: 52px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  object-fit: cover;
  background: #fff;
  flex: 0 0 auto;
}

.legend-text {
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.variant-modal .vertical-shell {
  height: min(66vh, 500px);
  grid-template-columns: minmax(0, 1fr) 320px;
  grid-template-rows: 1fr;
  gap: 12px;
  align-items: stretch;
}

.variant-modal .bubble-shell {
  height: min(64vh, 480px);
  padding: 14px 4px;
  overflow: visible;
}

.variant-modal .bubble-grid {
  min-height: 100%;
  align-content: start;
  overflow: visible;
  --bubble-gap: 22px;
  row-gap: 24px;
  padding-right: 0;
}

.variant-modal .bubble-card {
  min-height: 168px;
  aspect-ratio: auto;
}

.variant-modal .vertical-bars {
  display: flex;
  min-height: 0;
  height: 100%;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  gap: 10px;
  padding-bottom: 2px;
}

.variant-modal .vertical-col {
  flex: 0 0 clamp(92px, 11vw, 118px);
}

.variant-modal .vertical-track {
  min-height: min(40vh, 280px);
}

.variant-modal .vertical-legend {
  grid-template-columns: 1fr;
  max-height: 100%;
  overflow: auto;
  padding-right: 4px;
}

.variant-modal .legend-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@keyframes bubble-chip-in {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
}

@keyframes bubble-fill-rise {
  from {
    height: 0;
  }
  to {
    height: var(--bubble-pct, 0%);
  }
}

@media (max-width: 980px) {
  .bubble-slot.is-bottom {
    padding-bottom: 0;
    padding-top: 0;
  }

  .bubble-percent--bottom {
    top: -12px;
    bottom: auto;
  }

  .bubble-percent--bottom::after {
    top: auto;
    bottom: -6px;
    border-top: 6px solid #fff;
    border-bottom: 0;
  }

  .bubble-grid {
    max-width: none;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-content: stretch;
  }

  .variant-modal .bubble-shell {
    height: min(72vh, 600px);
  }

  .variant-modal .bubble-grid {
    grid-template-columns: 1fr;
  }

  .variant-modal .vertical-shell {
    height: auto;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }

  .variant-modal .vertical-legend {
    max-height: min(24vh, 220px);
  }
}
</style>
