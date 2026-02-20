<template>
  <div :class="['question-card', { 'question-card--dragging': !!draggingOrderId }]">
    <div data-no-i18n="1" style="font-size:18px; font-weight:700; margin-bottom:12px;">
      {{ question.text }}
    </div>

    <div v-if="question.promptImage" style="margin-bottom:12px; display:flex; justify-content:center;">
      <img :src="question.promptImage" alt="Question image"
           @click="openImageViewer(question.promptImage)"
           class="zoomable-image"
           style="max-width:100%; max-height:360px; object-fit:contain; border:1px solid #ddd; border-radius:10px; background:#fff; padding:6px; cursor:zoom-in;" />
    </div>
    <div v-if="question.promptAudio" style="margin-bottom:12px;">
      <audio :src="question.promptAudio" controls preload="metadata" style="width:100%;"></audio>
    </div>
    <div v-if="question.promptVideo" style="margin-bottom:12px;">
      <video :src="question.promptVideo" controls preload="metadata"
             style="width:100%; max-height:320px; border:1px solid #ddd; border-radius:10px; background:#000;"></video>
    </div>

    <div v-if="isEstimate" style="display:grid; gap:10px;">
      <input v-model="estimateValue"
             :disabled="disabled"
             type="number"
             step="any"
             :placeholder="t('Your estimate')"
             style="padding:12px; border-radius:12px; border:1px solid #ddd;" />
      <div class="submit-sticky">
        <button :disabled="disabled || !canSubmitEstimate"
                @click="submitEstimate"
                class="submit-btn">
          {{ t("Submit estimate") }}
        </button>
      </div>
    </div>

    <div v-else-if="isOrder" style="display:grid; gap:10px;">
      <div style="font-size:13px; opacity:0.75;">Sort via drag and drop (or with ↑/↓).</div>
      <div v-for="entry in orderEntries" :key="entry.key">
        <div v-if="entry.kind==='placeholder'"
             style="height:56px; border:2px dashed #94a3b8; border-radius:12px; background:#f8fafc;"></div>

        <div v-else
             :data-order-id="entry.option.id"
             @pointerdown="onOrderRowPointerDown($event, entry.option.id)"
             :style="disabled
               ? 'display:flex; gap:8px; align-items:center; border:1px solid #ddd; border-radius:12px; padding:14px; background:#fafafa; min-height:60px;'
               : 'display:flex; gap:8px; align-items:center; border:1px solid #ddd; border-radius:12px; padding:14px; background:#fff; cursor:move; min-height:60px;'">
          <div style="font-weight:900; min-width:24px;">{{ entry.rank }}.</div>
          <button v-if="!disabled"
                  @pointerdown.prevent.stop="startOrderPointer($event, entry.option.id)"
                  style="padding:4px 8px; border-radius:8px; border:1px solid #ddd; background:#fff; cursor:grab; touch-action:none;">
            ⇅
          </button>
          <div style="flex:1; display:grid; gap:8px;">
            <img v-if="entry.option.image" :src="entry.option.image" alt="Option image"
                 @click.stop="openImageViewer(entry.option.image)"
                 class="zoomable-image"
                 style="max-width:120px; max-height:72px; object-fit:cover; border:1px solid #ddd; border-radius:8px; background:#fff;" />
            <div data-no-i18n="1" style="font-weight:700;">{{ entry.option.text || "Option" }}</div>
          </div>
          <button @click="moveOrder(entry.rank - 1, -1)" :disabled="disabled || entry.rank===1"
                  style="padding:4px 8px; border-radius:8px; border:1px solid #ddd; background:#fff;">
            ↑
          </button>
          <button @click="moveOrder(entry.rank - 1, 1)" :disabled="disabled || entry.rank===order.length"
                  style="padding:4px 8px; border-radius:8px; border:1px solid #ddd; background:#fff;">
            ↓
          </button>
        </div>
      </div>
      <div class="submit-sticky">
        <button :disabled="disabled || order.length === 0"
                @click="emit('submit', [...order])"
                class="submit-btn">
          {{ t("Submit order") }}
        </button>
      </div>
    </div>

    <div v-else-if="question.allowMultiple" class="option-list">
      <label v-for="o in question.options" :key="o.id"
             :class="['option-tile', 'option-tile--check', { 'is-selected': multi.includes(String(o.id)) }]">
        <input type="checkbox" :disabled="disabled" :value="String(o.id)" v-model="multi" class="option-check" />
        <div :class="['option-content', { 'has-media': !!o.image }]">
          <div v-if="o.image" class="option-media-wrap">
            <img :src="o.image" alt="Option image"
                 @click.prevent.stop="openImageViewer(o.image)"
                 class="zoomable-image option-media" />
          </div>
          <span data-no-i18n="1" class="option-text">{{ o.text || "Option" }}</span>
        </div>
      </label>
      <div class="submit-sticky">
        <button :disabled="disabled || multi.length===0" @click="emit('submit', multi.map(String))"
                class="submit-btn">
          {{ t("Submit answer") }}
        </button>
      </div>
    </div>

    <div v-else class="option-list">
      <button v-for="o in question.options" :key="o.id"
              :disabled="disabled"
              @click="pickSingle(String(o.id))"
              :class="['option-tile', 'option-tile--single', { 'is-selected': single === String(o.id) }]">
        <div :class="['option-content', { 'has-media': !!o.image }]">
          <div v-if="o.image" class="option-media-wrap">
            <img :src="o.image" alt="Option image"
                 @click.stop.prevent="openImageViewer(o.image)"
                 class="zoomable-image option-media" />
          </div>
          <span data-no-i18n="1" class="option-text">{{ o.text || "Option" }}</span>
        </div>
      </button>
    </div>

    <div v-if="hint" style="margin-top:12px; font-size:13px; opacity:0.7;">
      {{ hint }}
    </div>

    <div v-if="imageViewerSrc" class="image-viewer" @click.self="closeImageViewer">
      <button @click="closeImageViewer" class="image-viewer-close">×</button>
      <img :src="imageViewerSrc" alt="Fullscreen" class="image-viewer-img" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "../i18n.js";

const props = defineProps({
  question: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
  hint: { type: String, default: "" },
  selectedOptionIds: { type: Array, default: () => [] }
});

const emit = defineEmits(["submit"]);
const { t } = useI18n();

const multi = ref([]);
const single = ref("");
const estimateValue = ref("");
const order = ref([]);
const draggingOrderId = ref(null);
const orderDropIndex = ref(null);
const lastQuestionId = ref(null);
const lastQuestionSignature = ref("");
const lastSelectionSignature = ref("");
const imageViewerSrc = ref("");

const type = computed(() => String(props.question?.type || "choice"));
const isEstimate = computed(() => type.value === "estimate");
const isOrder = computed(() => type.value === "order");

const optionMap = computed(() => {
  const map = new Map();
  for (const o of props.question?.options || []) {
    map.set(String(o.id), o);
  }
  return map;
});

const orderEntries = computed(() => {
  const dragId = draggingOrderId.value;
  const buildEntries = (ids, placeholderIndex = null) => {
    const rows = [];
    let rank = 1;
    for (let i = 0; i < ids.length; i++) {
      if (placeholderIndex === i) rows.push({ kind: "placeholder", key: "order-placeholder" });
      const option = optionMap.value.get(String(ids[i]));
      if (!option) continue;
      rows.push({ kind: "item", key: `order-${ids[i]}`, option, rank });
      rank += 1;
    }
    if (placeholderIndex === ids.length) rows.push({ kind: "placeholder", key: "order-placeholder" });
    return rows;
  };

  if (!dragId) return buildEntries(order.value, null);

  const base = order.value.filter(id => id !== dragId);
  const idxRaw = Number(orderDropIndex.value);
  const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.min(base.length, idxRaw)) : base.length;
  return buildEntries(base, idx);
});

const canSubmitEstimate = computed(() => {
  return String(estimateValue.value || "").trim().length > 0;
});

function signatureFromIds(ids) {
  return (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).join("|");
}

function questionSignature() {
  const q = props.question || {};
  const typeSig = String(q.type || "choice");
  const allowSig = q.allowMultiple ? "1" : "0";
  const optionsSig = (q.options || []).map(o => String(o.id)).join(",");
  return `${typeSig}|${allowSig}|${optionsSig}`;
}

function syncFromProps() {
  const selected = (props.selectedOptionIds || []).map(String).filter(Boolean);
  const optionIds = (props.question?.options || []).map(o => String(o.id));
  const qid = props.question?.id || null;
  const changedQuestion = qid !== lastQuestionId.value;
  const questionSig = questionSignature();
  const selectionSig = signatureFromIds(selected);
  const questionChangedStructurally = questionSig !== lastQuestionSignature.value;
  const selectionChanged = selectionSig !== lastSelectionSignature.value;

  if (!changedQuestion && !questionChangedStructurally && !selectionChanged) return;

  lastQuestionId.value = qid;
  lastQuestionSignature.value = questionSig;
  lastSelectionSignature.value = selectionSig;

  if (isEstimate.value) {
    estimateValue.value = selected[0] || "";
    multi.value = [];
    single.value = "";
    order.value = [];
    return;
  }

  if (isOrder.value) {
    const selectedUnique = [...new Set(selected)];
    const validSelection = selectedUnique.length === optionIds.length
      && selectedUnique.every(id => optionIds.includes(id));
    const currentValid = order.value.length === optionIds.length
      && order.value.every(id => optionIds.includes(id));
    if (validSelection) {
      order.value = selectedUnique;
    } else if (!currentValid || changedQuestion) {
      order.value = [...optionIds].sort(() => Math.random() - 0.5);
    }
    estimateValue.value = "";
    multi.value = [];
    single.value = "";
    return;
  }

  if (props.question?.allowMultiple) {
    multi.value = selected;
    single.value = "";
  } else {
    single.value = selected[0] || "";
    multi.value = [];
  }
  estimateValue.value = "";
  order.value = [];
}

function pickSingle(optionId) {
  single.value = String(optionId);
  emit("submit", [String(optionId)]);
}

function submitEstimate() {
  const val = String(estimateValue.value || "").trim();
  if (!val) return;
  emit("submit", [val]);
}

function startOrderDrag(optionId) {
  if (props.disabled) return;
  const id = String(optionId);
  draggingOrderId.value = id;
  orderDropIndex.value = order.value.findIndex(x => String(x) === id);
  setGlobalUserSelect(false);
}

function endOrderDrag() {
  draggingOrderId.value = null;
  orderDropIndex.value = null;
  setGlobalUserSelect(true);
}

function startOrderPointer(evt, optionId) {
  if (props.disabled) return;
  if (evt?.cancelable) evt.preventDefault();
  startOrderDrag(optionId);
  if (evt?.currentTarget?.setPointerCapture && evt?.pointerId !== undefined) {
    try { evt.currentTarget.setPointerCapture(evt.pointerId); } catch {}
  }
  window.addEventListener("pointermove", onOrderPointerMove, { passive: false });
  window.addEventListener("pointerup", onOrderPointerUp, { passive: false });
  window.addEventListener("pointercancel", onOrderPointerUp, { passive: false });
}

function onOrderRowPointerDown(evt, optionId) {
  if (props.disabled || draggingOrderId.value) return;
  const interactive = evt?.target?.closest?.("button,input,textarea,select,a,label");
  if (interactive) return;
  if (evt?.cancelable) evt.preventDefault();
  startOrderPointer(evt, optionId);
}

function onOrderPointerMove(evt) {
  if (!draggingOrderId.value) return;
  if (evt?.cancelable) evt.preventDefault();
  const target = document.elementFromPoint(evt.clientX, evt.clientY);
  if (!target) return;

  const item = target.closest?.("[data-order-id]");
  if (!item) return;
  const targetId = String(item.getAttribute("data-order-id") || "");
  if (!targetId) return;

  const rect = item.getBoundingClientRect();
  const targetIndex = order.value.findIndex(id => String(id) === targetId);
  if (targetIndex < 0) return;
  const insertAfter = evt.clientY > rect.top + rect.height / 2;
  const logicalId = insertAfter
    ? String(order.value[Math.min(targetIndex + 1, order.value.length - 1)] || targetId)
    : targetId;

  if (insertAfter && targetIndex === order.value.length - 1) {
    hoverOrderEnd();
    return;
  }
  hoverOrderOn(logicalId);
}

function onOrderPointerUp(evt) {
  if (evt?.cancelable) evt.preventDefault();
  finalizeOrderDrag();
  window.removeEventListener("pointermove", onOrderPointerMove);
  window.removeEventListener("pointerup", onOrderPointerUp);
  window.removeEventListener("pointercancel", onOrderPointerUp);
}

function hoverOrderOn(targetId) {
  if (props.disabled) return;
  const dragId = draggingOrderId.value;
  if (!dragId || dragId === String(targetId)) return;
  const base = order.value.filter(id => id !== dragId);
  const targetIndex = base.findIndex(id => String(id) === String(targetId));
  if (targetIndex < 0) return;
  orderDropIndex.value = targetIndex;
}

function hoverOrderEnd() {
  if (props.disabled || !draggingOrderId.value) return;
  const base = order.value.filter(id => id !== draggingOrderId.value);
  orderDropIndex.value = base.length;
}

function finalizeOrderDrag() {
  if (props.disabled) return;
  const dragId = draggingOrderId.value;
  if (!dragId) return;
  const base = order.value.filter(id => id !== dragId);
  const idxRaw = Number(orderDropIndex.value);
  const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.min(base.length, idxRaw)) : base.length;
  const arr = [...base];
  arr.splice(idx, 0, dragId);
  order.value = arr;
  endOrderDrag();
}

function setGlobalUserSelect(enabled) {
  if (typeof document === "undefined") return;
  const value = enabled ? "" : "none";
  document.body.style.userSelect = value;
  document.body.style.webkitUserSelect = value;
}

onBeforeUnmount(() => {
  setGlobalUserSelect(true);
  window.removeEventListener("pointermove", onOrderPointerMove);
  window.removeEventListener("pointerup", onOrderPointerUp);
  window.removeEventListener("pointercancel", onOrderPointerUp);
});

function moveOrder(index, delta) {
  if (props.disabled) return;
  const target = index + delta;
  if (target < 0 || target >= order.value.length) return;
  const arr = [...order.value];
  const [item] = arr.splice(index, 1);
  arr.splice(target, 0, item);
  order.value = arr;
}

function openImageViewer(src) {
  const val = String(src || "").trim();
  if (!val) return;
  imageViewerSrc.value = val;
}

function closeImageViewer() {
  imageViewerSrc.value = "";
}

watch(() => props.question?.id, syncFromProps, { immediate: true });
watch(() => props.question?.type, syncFromProps);
watch(() => props.question?.options, syncFromProps, { deep: true });
watch(() => props.selectedOptionIds, syncFromProps, { deep: true });
</script>

<style scoped>
.question-card {
  border: 1px solid #e5e5e5;
  border-radius: 14px;
  padding: 16px;
}

.option-list {
  display: grid;
  gap: 10px;
}

.option-tile {
  width: 100%;
  text-align: left;
  border-radius: 12px;
  border: 2px solid #d1d5db;
  background: #fff;
  color: #0f172a;
  min-height: 78px;
}

.option-tile--single {
  padding: 14px;
  cursor: pointer;
  font-size: 17px;
  font-weight: 700;
}

.option-tile--check {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  cursor: pointer;
}

.option-tile.is-selected {
  border-color: #004e96;
  background: #f0f7ff;
}

.option-check {
  width: 20px;
  height: 20px;
  margin-top: 8px;
  flex: 0 0 auto;
}

.option-content {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.option-content.has-media {
  grid-template-columns: 120px minmax(0, 1fr);
}

.option-media-wrap {
  width: 120px;
  height: 82px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  background: #fff;
}

.option-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.option-text {
  font-weight: 800;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.question-card--dragging,
.question-card--dragging * {
  user-select: none;
  -webkit-user-select: none;
}

.submit-btn {
  width: 100%;
  min-height: 54px;
  padding: 14px;
  border-radius: 12px;
  border: 0;
  background: #004e96;
  color: #fff;
  font-weight: 800;
  font-size: 16px;
}

.submit-btn:disabled {
  opacity: 0.58;
}

.submit-sticky {
  position: sticky;
  bottom: 8px;
  z-index: 5;
  margin-top: 2px;
  padding-top: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.96) 32%, rgba(255, 255, 255, 1) 100%);
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

@media (min-width: 900px) {
  .submit-sticky {
    position: static;
    padding-top: 0;
    background: transparent;
  }
}

@media (max-width: 640px) {
  .option-content.has-media {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .option-media-wrap {
    width: 100%;
    height: 140px;
  }
}
</style>
