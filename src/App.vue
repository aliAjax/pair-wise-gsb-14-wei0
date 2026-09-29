<script setup lang="ts">
import { computed, ref } from "vue";
import { usePriceStore } from "./store";
import type { PriceOrder } from "./types";
import CurrentPriceBar from "./components/CurrentPriceBar.vue";
import SubmitOrderForm from "./components/SubmitOrderForm.vue";
import OrderList from "./components/OrderList.vue";
import ReviewDialog from "./components/ReviewDialog.vue";
import VersionHistory from "./components/VersionHistory.vue";

const store = usePriceStore();

type Tab = "flow" | "versions";
const tab = ref<Tab>("flow");

const reviewing = ref<PriceOrder | null>(null);

function openReview(order: PriceOrder) {
  // 始终从最新状态取对象，避免弹窗拿着另一个窗口里的旧引用
  const fresh = store.state.orders.find((item) => item.id === order.id) ?? null;
  reviewing.value = fresh;
}

function closeReview() {
  reviewing.value = null;
}

const pendingCount = computed(() => store.state.orders.filter((o) => o.status === "pending").length);
const conflictCount = computed(() => store.state.orders.filter((o) => o.status === "conflicted").length);
const avgPrice = computed(() => {
  const snap = store.currentSnapshot;
  const values = Object.values(snap);
  return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
});

const metrics = computed(() => [
  { label: "当前版本", value: `v${store.latestVersion.version}` },
  { label: "待复核单据", value: pendingCount.value },
  { label: "版本冲突", value: conflictCount.value },
  { label: "平均挂牌价", value: avgPrice.value }
]);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 调价审批流程</p>
          <h1>油品价格维护</h1>
          <p class="subtitle">
            调价单 → 主管复核 → 价格版本 → 回滚记录。发版按提交时的价格快照生成，
            白班/夜班并发操作时乐观锁校验版本，后保存不会盖掉先发布的价格。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Pinia</span>
          <span class="tag">快照版本</span>
          <span class="tag">乐观并发</span>
          <button type="button" class="tag reset" @click="store.resetDemo()">重置演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="item in metrics" :key="item.label" class="metric">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <nav class="tabs">
        <button type="button" :class="{ active: tab === 'flow' }" @click="tab = 'flow'">
          调价与审批
          <em v-if="pendingCount" class="dot">{{ pendingCount }}</em>
        </button>
        <button type="button" :class="{ active: tab === 'versions' }" @click="tab = 'versions'">
          版本与回滚
          <em v-if="conflictCount" class="dot danger">{{ conflictCount }}</em>
        </button>
      </nav>

      <CurrentPriceBar />

      <section v-if="tab === 'flow'" class="workspace">
        <SubmitOrderForm />
        <OrderList @review="openReview" />
      </section>

      <VersionHistory v-else />

      <ReviewDialog :order="reviewing" @closed="closeReview" />
    </div>
  </main>
</template>

<style>
/* 全局基础样式见 styles.css */
</style>
