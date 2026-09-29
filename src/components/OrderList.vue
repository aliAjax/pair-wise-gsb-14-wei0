<script setup lang="ts">
import { computed, ref } from "vue";
import { ORDER_STATUS_LABEL, type OrderStatus, type PriceOrder } from "../types";
import { usePriceStore } from "../store";

const emit = defineEmits<{ review: [order: PriceOrder] }>();

const store = usePriceStore();
const filter = ref<"all" | OrderStatus>("all");

const FILTERS: { value: "all" | OrderStatus; label: string }[] = [
  { value: "all", label: "全部单据" },
  { value: "pending", label: "待复核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "conflicted", label: "版本冲突" }
];

const orders = computed(() =>
  filter.value === "all" ? store.state.orders : store.state.orders.filter((o) => o.status === filter.value)
);

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function changedPrices(order: PriceOrder) {
  const base = store.versionAt(order.baseVersion);
  if (!base) return [];
  return Object.entries(order.snapshot).filter(([fuel, price]) => price !== base.snapshot[fuel as keyof typeof base.snapshot]);
}
</script>

<template>
  <section class="panel list-panel">
    <div class="toolbar">
      <h2>调价单流程</h2>
      <select v-model="filter">
        <option v-for="item in FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
    </div>

    <div class="record-grid">
      <div v-if="orders.length === 0" class="empty">暂无匹配单据</div>

      <article v-for="order in orders" :key="order.id" class="record" :class="`st-${order.status}`">
        <div class="record-head">
          <div>
            <p class="record-title">{{ order.code }}</p>
            <p class="record-sub">
              {{ order.submitter }} 提交于 {{ fmtTime(order.submittedAt) }} ｜
              基于 <strong>v{{ order.baseVersion }}</strong>
              <template v-if="order.publishedVersion"> ｜ 已发布 <strong>v{{ order.publishedVersion }}</strong></template>
            </p>
          </div>
          <span class="status" :class="order.status">{{ ORDER_STATUS_LABEL[order.status] }}</span>
        </div>

        <div class="changed">
          <template v-if="changedPrices(order).length">
            调价：
            <span v-for="[fuel, price] in changedPrices(order)" :key="fuel" class="chip">
              {{ fuel }} → {{ Number(price).toFixed(2) }}
            </span>
          </template>
          <span v-else class="no-change">快照与基准一致（无价差）</span>
        </div>

        <p class="note">站长说明：{{ order.note }}</p>

        <div v-if="order.reviewComment" class="review-box" :class="{ conflict: order.status === 'conflicted' }">
          <p>
            <strong>{{ order.reviewer }}</strong> 审批意见（已保留）：{{ order.reviewComment }}
            <span class="review-time">{{ order.reviewedAt ? fmtTime(order.reviewedAt) : "" }}</span>
          </p>
          <p v-if="order.status === 'conflicted'" class="conflict-msg">
            复核时发现 v{{ order.conflictVersion }} 已由另一班发布，本单快照未生效、未覆盖对方价格；
            需要的话请站长按最新 v{{ order.conflictVersion }} 重新提交。
          </p>
        </div>

        <div class="actions">
          <button v-if="order.status === 'pending'" type="button" @click="emit('review', order)">主管复核</button>
          <span v-else-if="order.status === 'approved'" class="link-text">
            生效日期 {{ store.versionAt(order.publishedVersion!)?.effectiveDate }}
          </span>
          <span v-else-if="order.status === 'rejected'" class="link-text muted">单据已驳回，未产生新版本</span>
          <span v-else class="link-text muted">快照冻结于提交时，可重新提交新单</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
h2 { margin: 0; font-size: 20px; }
.record-grid { display: grid; gap: 12px; }
.record {
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 14px;
  background: #fbfcfe;
}
.record.st-conflicted { border-color: #f0c3b0; background: #fffaf7; }
.record-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.record-title { margin: 0; font-size: 16px; font-weight: 800; }
.record-sub { margin: 4px 0 0; color: #8a94a8; font-size: 12px; }
.status {
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.status.pending { background: #fff4df; color: #9a6a08; }
.status.approved { background: #e8f4ef; color: #14724f; }
.status.rejected { background: #f3e5e2; color: #8f3b25; }
.status.conflicted { background: #fde2d8; color: #b04a2f; }
.changed { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; font-size: 13px; color: #536078; }
.chip {
  background: #eef5fb;
  border-radius: 999px;
  padding: 3px 9px;
  font-variant-numeric: tabular-nums;
}
.no-change { color: #9aa3b4; font-size: 12px; }
.note {
  color: #445069;
  background: #eef5fb;
  border-radius: 8px;
  padding: 9px 11px;
  margin: 0 0 10px;
  font-size: 13px;
}
.review-box {
  border-left: 3px solid #176b87;
  background: #f6f9fc;
  border-radius: 0 8px 8px 0;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #445069;
}
.review-box.conflict { border-left-color: #c84b31; background: #fdf3f0; }
.review-box p { margin: 0; line-height: 1.7; }
.review-time { color: #9aa3b4; margin-left: 6px; font-size: 12px; }
.conflict-msg { color: #a33b22; margin-top: 4px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.link-text { font-size: 13px; color: #176b87; }
.link-text.muted { color: #8a94a8; }
.empty { text-align: center; color: #69758c; padding: 32px 12px; }
</style>
