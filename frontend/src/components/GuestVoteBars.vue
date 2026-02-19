<template>
  <div v-if="votes && votes.length" :style="wrapperStyle">
    <div v-for="v in votes" :key="v.id" :style="columnStyle">
      
      <!-- Label oben auf dem Balken -->
      <div v-if="v.count > 0" 
           class="count-label"
           :style="{ fontWeight: 900, fontSize: compact ? '14px' : '24px', marginBottom: '8px', animation: 'fadeIn 0.5s ease-out forwards', opacity: 0 }">
        {{ v.count }}
      </div>

      <!-- Der Balken -->
      <div class="bar" 
           :style="barStyle(v)" 
           style="width:100%; border-radius:12px 12px 0 0; position:relative; transition: height 1s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        
        <!-- Hinweis für Spielerantwort -->
        <div v-if="playerAnswer.includes(String(v.id))" 
             data-no-i18n="1"
             :style="{ position:'absolute', top: compact ? '-24px' : '-40px', left:'50%', transform:'translateX(-50%)', whiteSpace:'nowrap', fontWeight:900, color:'#e10011', fontSize: compact ? '11px' : '14px' }">
          {{ playerLabel }}
        </div>

        <!-- Korrekt-Häkchen -->
        <div v-if="v.isCorrect" 
             :style="{ position:'absolute', bottom:'8px', left:'50%', transform:'translateX(-50%)', color:'#fff', fontSize: compact ? '18px' : '32px', fontWeight:900 }">
          ✓
        </div>
      </div>

      <!-- Antworttext unter dem Balken -->
      <div data-no-i18n="1" :style="{ position:'absolute', top:'100%', marginTop:'12px', fontSize: compact ? '11px' : '16px', fontWeight:800, textAlign:'center', width: compact ? '90px' : '140px', lineHeight:'1.2' }">
        {{ v.text }}
      </div>
    </div>
  </div>
  <div v-else style="opacity:0.75; font-size:18px; text-align:center;">
    No guest answers yet.
  </div>
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
const wrapperStyle = computed(() => ({
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-end",
  gap: compact.value ? "14px" : "30px",
  height: compact.value ? "180px" : "350px",
  paddingBottom: compact.value ? "42px" : "60px",
  marginTop: compact.value ? "8px" : "40px"
}));
const columnStyle = computed(() => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  position: "relative",
  width: compact.value ? "62px" : "100px"
}));

const max = computed(() => {
  const arr = props.votes || [];
  return Math.max(1, ...arr.map(v => Number(v.count || 0)));
});

function barStyle(v) {
  const targetMaxHeight = compact.value ? 140 : 300;
  const h = Math.round((Number(v.count || 0) / max.value) * targetMaxHeight);
  return {
    height: h + 'px',
    background: v.isCorrect ? '#004e96' : '#999',
    border: props.playerAnswer.includes(String(v.id)) ? (compact.value ? '3px solid #e10011' : '6px solid #e10011') : 'none',
    boxSizing: 'border-box'
  };
}
</script>

<style scoped>
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.count-label {
  animation-delay: 0.8s;
}
</style>
