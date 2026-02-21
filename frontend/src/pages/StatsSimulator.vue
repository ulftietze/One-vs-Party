<template>
  <div class="sim-page">
    <div class="sim-head">
      <h1>Stats Simulator (temporary)</h1>
      <div class="sim-sub">
        Local preview only. No backend writes.
      </div>
    </div>

    <div class="sim-layout">
      <section class="sim-card sim-card--controls">
        <div class="sim-card-title">Controls</div>
        <div class="ctrl-grid">
          <label class="ctrl-field">
            <span>Mode</span>
            <select v-model="mode">
              <option value="bubble">Bubble</option>
              <option value="vertical">Vertical</option>
              <option value="mini">Mini</option>
            </select>
          </label>
          <label class="ctrl-field">
            <span>Variant</span>
            <select v-model="variant">
              <option value="modal">Modal</option>
              <option value="default">Default</option>
            </select>
          </label>
          <label class="ctrl-field">
            <span>Player label</span>
            <input v-model="playerLabel" type="text" />
          </label>
          <label class="ctrl-field">
            <span>Target guests</span>
            <input v-model.number="guestTarget" type="number" min="0" step="1" />
          </label>
        </div>
        <div class="ctrl-actions">
          <button @click="addOption">Add option</button>
          <button @click="removeLastOption" :disabled="rows.length <= 2">Remove last</button>
          <button @click="applyEvenSplit">Even split</button>
          <button @click="randomizeCounts">Randomize</button>
          <button @click="scaleCountsToTarget">Scale to target</button>
          <button @click="resetDefaults">Reset</button>
        </div>
      </section>

      <section class="sim-card">
        <div class="sim-card-title">Options</div>
        <div class="option-list">
          <div v-for="(row, idx) in rows" :key="row.id" class="option-row">
            <div class="option-letter">{{ letterFor(idx) }}</div>
            <input v-model="row.text" type="text" placeholder="Answer text" />
            <input v-model.number="row.count" type="number" min="0" step="1" @change="normalizeCounts" />
            <input v-model="row.image" type="text" placeholder="Image URL (optional)" />
            <label class="flag">
              <input v-model="row.isCorrect" type="checkbox" />
              Correct
            </label>
            <label class="flag">
              <input v-model="row.playerSelected" type="checkbox" />
              Player
            </label>
            <button @click="removeOption(idx)" :disabled="rows.length <= 2">×</button>
          </div>
        </div>
      </section>
    </div>

    <section class="sim-card sim-card--preview">
      <div class="sim-card-title">
        Preview · {{ totalVotes }} votes · {{ rows.length }} options
      </div>
      <div class="preview-frame">
        <GuestVoteBars
          :votes="votes"
          :player-answer="playerAnswer"
          :player-label="playerLabel"
          :mode="mode"
          :variant="variant"
          :max-items="3" />
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import GuestVoteBars from "../components/GuestVoteBars.vue";

const STORAGE_KEY = "quizduell_stats_sim_v1";

let nextId = 1;
function makeRow(seed = {}) {
  return {
    id: seed.id ?? `sim-${nextId++}`,
    text: String(seed.text || ""),
    count: Number(seed.count || 0),
    image: String(seed.image || ""),
    isCorrect: !!seed.isCorrect,
    playerSelected: !!seed.playerSelected
  };
}

function defaultRows() {
  return [
    makeRow({ text: "Athens", count: 34 }),
    makeRow({ text: "Delphi", count: 5 }),
    makeRow({ text: "Sparta", count: 2 }),
    makeRow({ text: "Olympia", count: 59, isCorrect: true, playerSelected: true })
  ];
}

const rows = ref(defaultRows());
const mode = ref("bubble");
const variant = ref("modal");
const playerLabel = ref("Player");
const guestTarget = ref(100);

const votes = computed(() => rows.value.map(row => ({
  id: row.id,
  text: String(row.text || "").trim() || "Option",
  image: String(row.image || "").trim(),
  count: Math.max(0, Math.round(Number(row.count || 0))),
  isCorrect: !!row.isCorrect
})));

const playerAnswer = computed(() => rows.value.filter(r => r.playerSelected).map(r => String(r.id)));
const totalVotes = computed(() => votes.value.reduce((sum, v) => sum + Number(v.count || 0), 0));

function letterFor(index) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < alphabet.length) return alphabet[index];
  const base = alphabet[index % alphabet.length];
  const suffix = Math.floor(index / alphabet.length) + 1;
  return `${base}${suffix}`;
}

function normalizeCounts() {
  for (const row of rows.value) {
    const n = Number(row.count || 0);
    row.count = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
}

function addOption() {
  rows.value.push(makeRow({ text: `Option ${rows.value.length + 1}`, count: 0 }));
}

function removeOption(index) {
  if (rows.value.length <= 2) return;
  rows.value.splice(index, 1);
}

function removeLastOption() {
  if (rows.value.length <= 2) return;
  rows.value.pop();
}

function applyEvenSplit() {
  const target = Math.max(0, Math.round(Number(guestTarget.value || 0)));
  if (!rows.value.length) return;
  const base = Math.floor(target / rows.value.length);
  let rest = target % rows.value.length;
  rows.value.forEach((row) => {
    row.count = base + (rest > 0 ? 1 : 0);
    rest -= 1;
  });
}

function randomizeCounts() {
  const target = Math.max(0, Math.round(Number(guestTarget.value || 0)));
  if (!rows.value.length) return;
  rows.value.forEach((row) => {
    row.count = Math.floor(Math.random() * (target + 1));
  });
  scaleCountsToTarget();
}

function scaleCountsToTarget() {
  const target = Math.max(0, Math.round(Number(guestTarget.value || 0)));
  const raw = rows.value.map(r => Math.max(0, Number(r.count || 0)));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!rows.value.length) return;

  if (sum <= 0) {
    rows.value.forEach((row, idx) => {
      row.count = idx === 0 ? target : 0;
    });
    return;
  }

  const scaled = raw.map(v => (v / sum) * target);
  const ints = scaled.map(v => Math.floor(v));
  let remaining = target - ints.reduce((a, b) => a + b, 0);

  const order = scaled
    .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < order.length && remaining > 0; i++) {
    ints[order[i].idx] += 1;
    remaining -= 1;
  }

  rows.value.forEach((row, idx) => {
    row.count = ints[idx];
  });
}

function resetDefaults() {
  nextId = 1;
  rows.value = defaultRows();
  mode.value = "bubble";
  variant.value = "modal";
  playerLabel.value = "Player";
  guestTarget.value = 100;
}

function saveLocal() {
  if (typeof localStorage === "undefined") return;
  const payload = {
    rows: rows.value,
    mode: mode.value,
    variant: variant.value,
    playerLabel: playerLabel.value,
    guestTarget: guestTarget.value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

onMounted(() => {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const loadedRows = Array.isArray(parsed?.rows) ? parsed.rows.map(makeRow) : [];
    if (loadedRows.length >= 2) rows.value = loadedRows;
    mode.value = ["bubble", "vertical", "mini"].includes(String(parsed?.mode)) ? String(parsed.mode) : "bubble";
    variant.value = ["modal", "default"].includes(String(parsed?.variant)) ? String(parsed.variant) : "modal";
    playerLabel.value = String(parsed?.playerLabel || "Player");
    guestTarget.value = Math.max(0, Math.round(Number(parsed?.guestTarget || 100)));
  } catch {}
});

watch(rows, saveLocal, { deep: true });
watch([mode, variant, playerLabel, guestTarget], saveLocal);
</script>

<style scoped>
.sim-page {
  max-width: 1400px;
  margin: 20px auto;
  padding: 0 14px 24px;
  display: grid;
  gap: 12px;
}

.sim-head h1 {
  margin: 0;
  font-size: 30px;
  color: #004e96;
}

.sim-sub {
  margin-top: 4px;
  color: #334155;
  font-weight: 700;
}

.sim-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

.sim-card {
  border: 1px solid #d7e4f3;
  border-radius: 14px;
  background: #f8fbff;
  padding: 12px;
}

.sim-card-title {
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #004e96;
  margin-bottom: 10px;
}

.ctrl-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.ctrl-field {
  display: grid;
  gap: 5px;
  font-weight: 700;
  color: #0f172a;
}

.ctrl-field span {
  font-size: 12px;
}

.ctrl-field input,
.ctrl-field select {
  min-width: 0;
  border-radius: 10px;
  border: 1px solid #bfd4ed;
  padding: 8px 10px;
  background: #fff;
}

.ctrl-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ctrl-actions button {
  border-radius: 10px;
  border: 1px solid #bfd4ed;
  background: #fff;
  color: #0f172a;
  font-weight: 800;
  padding: 8px 10px;
  cursor: pointer;
}

.ctrl-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.option-list {
  display: grid;
  gap: 8px;
}

.option-row {
  display: grid;
  grid-template-columns: 34px minmax(200px, 1fr) 100px minmax(180px, 1fr) auto auto 36px;
  gap: 8px;
  align-items: center;
}

.option-letter {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: #1e3a8a;
  color: #fff;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
}

.option-row input[type="text"],
.option-row input[type="number"] {
  min-width: 0;
  border-radius: 10px;
  border: 1px solid #bfd4ed;
  padding: 8px 10px;
  background: #fff;
}

.flag {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
  white-space: nowrap;
}

.option-row button {
  border-radius: 10px;
  border: 1px solid #bfd4ed;
  background: #fff;
  font-weight: 900;
  padding: 6px 8px;
  cursor: pointer;
}

.preview-frame {
  border: 2px solid #93c5fd;
  border-radius: 14px;
  background: #e9f2ff;
  padding: 10px;
  min-height: 320px;
}

@media (max-width: 1100px) {
  .ctrl-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .option-row {
    grid-template-columns: 30px minmax(0, 1fr) 90px minmax(0, 1fr) auto auto 34px;
  }
}

@media (max-width: 760px) {
  .ctrl-grid {
    grid-template-columns: 1fr;
  }

  .option-row {
    grid-template-columns: 30px minmax(0, 1fr);
  }
}
</style>
