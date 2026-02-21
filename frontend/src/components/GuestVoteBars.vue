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

    <div v-else class="vertical-shell">
      <div class="vertical-bars">
        <div v-for="item in items" :key="item.id" class="vertical-col">
          <div class="vertical-count">{{ item.count }}</div>
          <div class="vertical-track">
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
        <div v-for="item in items" :key="`legend-${item.id}`" class="legend-row">
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
  if (value === "mini" || value === "vertical") return value;
  return props.compact ? "mini" : "vertical";
});

function letterFor(index) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < alphabet.length) return alphabet[index];
  const base = alphabet[index % alphabet.length];
  const suffix = Math.floor(index / alphabet.length) + 1;
  return `${base}${suffix}`;
}

const maxCount = computed(() => Math.max(1, ...(props.votes || []).map(v => Number(v?.count || 0))));
const items = computed(() => {
  const selected = new Set((props.playerAnswer || []).map(String));
  return (props.votes || []).map((v, idx) => {
    const count = Number(v?.count || 0);
    const pct = Math.max(0, Math.min(100, Math.round((count / maxCount.value) * 100)));
    const minVisiblePct = count > 0 ? 12 : 0;
    return {
      id: v?.id,
      letter: letterFor(idx),
      text: String(v?.text || ""),
      image: String(v?.image || ""),
      count,
      pct,
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
  box-shadow: inset 0 0 0 1px #99f6e4;
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

@media (max-width: 980px) {
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
