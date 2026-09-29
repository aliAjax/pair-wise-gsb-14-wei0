<script setup lang="ts">
import { computed } from "vue";
import { usePriceStore } from "../store";
import SnapshotTable from "./SnapshotTable.vue";

const store = usePriceStore();

const latest = computed(() => store.latestVersion);
const sourceLabel = computed(() => {
  switch (latest.value.source) {
    case "approval":
      return `审批通过（单据 ${latest.value.orderCode}）`;
    case "rollback":
      return `回滚：恢复审批时快照，来源 v${latest.value.rollbackFromVersion}`;
    default:
      return "基线版本";
  }
});
</script>

<template>
  <section class="current-bar">
    <div class="current-head">
      <div>
        <p class="eyebrow">当前生效价格</p>
        <h2>v{{ latest.version }} · {{ sourceLabel }}</h2>
        <p class="meta">
          生效日期 {{ latest.effectiveDate }} ｜ 操作人 {{ latest.operator }}
          <template v-if="latest.comment"> ｜ {{ latest.comment }}</template>
        </p>
      </div>
      <div class="badge" :class="latest.source">
        {{ { baseline: "基线", approval: "审批发版", rollback: "回滚恢复" }[latest.source] }}
      </div>
    </div>
    <SnapshotTable :snapshot="store.currentSnapshot" compact />
  </section>
</template>

<style scoped>
.current-bar {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.current-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 10px;
}
.eyebrow { margin: 0 0 4px; color: #176b87; font-weight: 700; font-size: 12px; }
h2 { margin: 0; font-size: 18px; }
.meta { margin: 6px 0 0; color: #69758c; font-size: 13px; }
.badge {
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.badge.baseline { background: #eef2f7; color: #5b667a; }
.badge.approval { background: #e8f4ef; color: #14724f; }
.badge.rollback { background: #fdf0e6; color: #b3541e; }
</style>
