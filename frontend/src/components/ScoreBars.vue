<template>
  <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
    <div>
      <div style="display:flex; justify-content:space-between; font-weight:800; color:#e10011; font-size:18px;">
        <span>{{ playerLabel }}</span><span>{{ score.player }}</span>
      </div>
      <div style="height:20px; background:#eee; border-radius:10px; overflow:hidden; border:1px solid #ddd;">
        <div :style="{ height:'20px', width: playerPct + '%', background:'#e10011', transition:'width 1s ease' }"></div>
      </div>
    </div>
    <div>
      <div style="display:flex; justify-content:space-between; font-weight:800; color:#004e96; font-size:18px;">
        <span>Guests</span><span>{{ score.guests }}</span>
      </div>
      <div style="height:20px; background:#eee; border-radius:10px; overflow:hidden; border:1px solid #ddd;">
        <div :style="{ height:'20px', width: guestPct + '%', background:'#004e96', transition:'width 1s ease' }"></div>
      </div>
    </div>
    <div style="font-size:12px; opacity:0.7;">
      Leading: <b>{{ leader }}</b>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  score: { type: Object, required: true },
  playerName: { type: String, default: "Player" }
});

const playerLabel = computed(() => props.playerName || "Player");
const minScore = computed(() => Math.min(0, Number(props.score.player || 0), Number(props.score.guests || 0)));
const shiftedPlayer = computed(() => Number(props.score.player || 0) - minScore.value);
const shiftedGuest = computed(() => Number(props.score.guests || 0) - minScore.value);
const total = computed(() => Math.max(1, shiftedPlayer.value + shiftedGuest.value));
const playerPct = computed(() => Math.round((shiftedPlayer.value / total.value) * 100));
const guestPct = computed(() => Math.round((shiftedGuest.value / total.value) * 100));
const leader = computed(() => {
  if ((props.score.player || 0) > (props.score.guests || 0)) return playerLabel.value;
  if ((props.score.player || 0) < (props.score.guests || 0)) return "Guests";
  return "Tie";
});
</script>
