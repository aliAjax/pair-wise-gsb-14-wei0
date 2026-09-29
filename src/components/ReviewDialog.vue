<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PriceOrder } from "../types";
import { usePriceStore } from "../store";
import SnapshotTable from "./SnapshotTable.vue";

const props = defineProps<{ order: PriceOrder | null }>();
const emit = defineEmits<{ closed: [] }>();

const store = usePriceStore();

const reviewer = ref("主管·王敏");
const comment = ref("同意");
const effectiveDate = ref(new Date().toISOString().slice(0, 10));
/** 打开弹窗时记录的并发令牌；另一班在此期间发版会导致令牌失效 */
const expectedRev = ref(0);
const errorMsg = ref("");
const submitting = ref(false);
const lastAction = ref<"approve" | "reject">("approve");

const baseVersion = computed(() => (props.order ? store.versionAt(props.order.baseVersion) : undefined));
const latest = computed(() => store.latestVersion);

// 是否已落后于最新版本（对方先发布）
const outdated = computed(() => {
  if (!props.order) return false;
  return props.order.baseVersion !== latest.value.version;
});

watch(
  () => props.order,
  (order) => {
    if (order) {
      expectedRev.value = store.currentRev();
      errorMsg.value = "";
      submitting.value = false;
      comment.value = order.reviewComment ?? "同意";
      effectiveDate.value = new Date().toISOString().slice(0, 10);
    }
  },
  { immediate: true }
);

function close() {
  emit("closed");
}

function run(action: "approve" | "reject") {
  if (!props.order) return;
  submitting.value = true;
  errorMsg.value = "";
  lastAction.value = action;
  const payload = {
    orderId: props.order.id,
    reviewer: reviewer.value.trim(),
    comment: comment.value.trim(),
    effectiveDate: effectiveDate.value,
    expectedRev: expectedRev.value
  };
  const result = action === "approve" ? store.approveOrder(payload) : store.rejectOrder(payload);

  if (result.ok) {
    close();
    return;
  }

  // 版本已经变化：
  // - 审批意见与复核人已保留在单据上（见 store.approveOrder）
  // - 绝不会把另一班刚发布的价格盖掉
  expectedRev.value = result.currentRev;
  const latestNow = store.latestVersion;
  if (props.order.baseVersion !== latestNow.version) {
    errorMsg.value =
      `检测到价格版本已变化：另一班已发布 v${latestNow.version}，` +
      `本单基于 v${props.order.baseVersion}，已标记为「版本冲突」，您的复核意见已保留。请关闭后在列表查看。`;
  } else {
    errorMsg.value =
      `单据数据已被另一窗口更新（当前最新 v${latestNow.version}），价格未发布新版本。` +
      `可点「重试」按最新状态重新提交，复核意见不会丢失。`;
  }
  submitting.value = false;
}

function retry() {
  run(lastAction.value);
}
</script>

<template>
  <div v-if="order" class="modal-mask" @click.self="close">
    <div class="modal">
      <header class="modal-head">
        <div>
          <p class="eyebrow">主管复核 · {{ order.code }}</p>
          <h3>提交人 {{ order.submitter }}</h3>
        </div>
        <button type="button" class="icon-btn" @click="close">✕</button>
      </header>

      <div v-if="outdated" class="warn">
        ⚠ 本单基于 v{{ order.baseVersion }}，当前已是 v{{ latest.version }}（另一班可能已发版）。
        系统不会用本单快照覆盖新版本。
      </div>

      <div class="snapshot-block">
        <p class="block-label">提交时价格快照（通过时将原样生成新版本）<em>基准 v{{ order.baseVersion }}</em></p>
        <SnapshotTable :snapshot="order.snapshot" :baseline="baseVersion?.snapshot" compact />
      </div>

      <p class="order-note">站长说明：{{ order.note }}</p>

      <div class="form-row">
        <label>
          复核人
          <input v-model="reviewer" required placeholder="主管姓名" />
        </label>
        <label>
          生效日期
          <input v-model="effectiveDate" type="date" required />
        </label>
      </div>
      <label class="comment-label">
        审批意见（冲突时也会保留在单据上）
        <textarea v-model="comment" rows="2" />
      </label>

      <div v-if="errorMsg" class="error">
        {{ errorMsg }}
        <button type="button" class="link-btn" @click="retry">按最新状态重试</button>
      </div>

      <footer class="modal-actions">
        <button type="button" class="secondary" :disabled="submitting" @click="close">取消</button>
        <button type="button" class="danger" :disabled="submitting || outdated" @click="run('reject')">驳回</button>
        <button type="button" :disabled="submitting || outdated" @click="run('approve')">通过并发布新版本</button>
      </footer>
      <p v-if="outdated" class="foot-note">已落后于最新版本，不能直接通过；如需调整请由站长按 v{{ latest.version }} 重新提交。</p>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(23, 32, 51, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}
.modal {
  background: #fff;
  border-radius: 12px;
  width: min(560px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 20px 22px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.eyebrow { margin: 0 0 4px; color: #176b87; font-weight: 700; font-size: 12px; }
h3 { margin: 0; font-size: 17px; }
.icon-btn {
  background: #eef2f7;
  color: #5b667a;
  padding: 6px 10px;
}
.warn {
  background: #fdf0e6;
  color: #b3541e;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 12px;
}
.block-label {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 700;
  color: #445069;
}
.block-label em {
  float: right;
  font-style: normal;
  font-weight: 500;
  color: #8a94a8;
}
.order-note {
  background: #eef5fb;
  border-radius: 8px;
  padding: 9px 12px;
  color: #445069;
  font-size: 13px;
  margin: 12px 0;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 12px 0;
}
.comment-label { display: grid; gap: 6px; color: #445069; font-size: 13px; }
.error {
  margin-top: 12px;
  background: #fdece8;
  border: 1px solid #f3c3b6;
  color: #a33b22;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
}
.link-btn {
  display: inline;
  background: none;
  color: #a33b22;
  padding: 0 4px;
  text-decoration: underline;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.foot-note { margin: 8px 0 0; font-size: 12px; color: #8a94a8; text-align: right; }
</style>
