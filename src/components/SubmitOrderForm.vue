<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { FUELS, type PriceSnapshot } from "../types";
import { usePriceStore } from "../store";

const emit = defineEmits<{ submitted: [] }>();

const store = usePriceStore();
const baseVersion = computed(() => store.latestVersion.version);

const draft = reactive<PriceSnapshot>({
  "92号汽油": 0,
  "95号汽油": 0,
  "98号汽油": 0,
  "柴油": 0
});
const submitter = ref("站长·李强");
const effectiveDate = ref(new Date().toISOString().slice(0, 10));
const note = ref("");

function syncDraftFromCurrent() {
  FUELS.forEach((fuel) => {
    draft[fuel] = store.currentSnapshot[fuel];
  });
}
syncDraftFromCurrent();
// 另一班发版后，表单基准价跟着刷新，避免在旧价上盲改
watch(() => store.latestVersion.version, syncDraftFromCurrent);

function resetPrices() {
  syncDraftFromCurrent();
}

const changedCount = computed(
  () => FUELS.filter((fuel) => draft[fuel] !== store.currentSnapshot[fuel]).length
);

function submit() {
  store.submitOrder({
    snapshot: { ...draft },
    submitter: submitter.value.trim(),
    effectiveDate: effectiveDate.value,
    note: note.value.trim()
  });
  note.value = "";
  emit("submitted");
}

const valid = computed(() => FUELS.every((fuel) => Number.isFinite(draft[fuel]) && draft[fuel] > 0));
</script>

<template>
  <form class="panel submit-panel" @submit.prevent="submit">
    <h2>提交调价单</h2>
    <p class="hint">
      站长按当前 <strong>v{{ baseVersion }}</strong> 价格拟价，提交后形成<b>价格快照</b>进入待复核；
      快照不再随后续价格改动变化。
    </p>

    <div class="price-grid">
      <label v-for="fuel in FUELS" :key="fuel">
        {{ fuel }}
        <div class="price-input">
          <input v-model.number="draft[fuel]" type="number" step="0.01" min="0" required />
          <span v-if="draft[fuel] !== store.currentSnapshot[fuel]" class="changed">已改</span>
        </div>
      </label>
    </div>

    <div class="form-row">
      <label>
        提交人
        <input v-model="submitter" required placeholder="站长姓名" />
      </label>
      <label>
        生效日期
        <input v-model="effectiveDate" type="date" required />
      </label>
    </div>

    <label>
      调价说明
      <textarea v-model="note" placeholder="说明调价原因、依据，供主管复核" />
    </label>

    <div class="form-actions">
      <button type="button" class="secondary" @click="resetPrices">恢复当前价</button>
      <button type="submit" :disabled="!valid">提交待复核（改了 {{ changedCount }} 项）</button>
    </div>
  </form>
</template>

<style scoped>
.submit-panel .hint {
  margin: 0 0 14px;
  color: #69758c;
  font-size: 13px;
  line-height: 1.7;
  background: #f6f9fc;
  border-radius: 8px;
  padding: 10px 12px;
}
.price-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}
.price-input { position: relative; }
.price-input input { padding-right: 44px; }
.changed {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: #b3541e;
  background: #fdf0e6;
  border-radius: 999px;
  padding: 2px 7px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
