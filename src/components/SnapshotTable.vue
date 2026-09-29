<script setup lang="ts">
import { computed } from "vue";
import { FUELS, type PriceSnapshot } from "../types";

const props = defineProps<{
  snapshot: PriceSnapshot;
  /** 传入后展示与该基准的差价（审批弹窗/冲突提示用） */
  baseline?: PriceSnapshot;
  compact?: boolean;
}>();

const rows = computed(() =>
  FUELS.map((fuel) => {
    const price = props.snapshot[fuel];
    const base = props.baseline?.[fuel];
    const delta = base === undefined ? null : Number((price - base).toFixed(2));
    return { fuel, price, delta };
  })
);

function deltaType(delta: number | null) {
  if (delta === null || delta === 0) return "flat";
  return delta > 0 ? "up" : "down";
}
</script>

<template>
  <table class="snapshot-table" :class="{ compact }">
    <thead>
      <tr>
        <th>油品</th>
        <th class="num">挂牌价</th>
        <th v-if="baseline" class="num">较基准</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.fuel">
        <td>{{ row.fuel }}</td>
        <td class="num">{{ row.price.toFixed(2) }}</td>
        <td v-if="baseline" class="num">
          <span :class="['delta', deltaType(row.delta)]">
            <template v-if="row.delta === null">—</template>
            <template v-else-if="row.delta === 0">持平</template>
            <template v-else>{{ row.delta > 0 ? "+" : "" }}{{ row.delta.toFixed(2) }}</template>
          </span>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.snapshot-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.snapshot-table th,
.snapshot-table td {
  border-bottom: 1px solid #e7edf4;
  padding: 7px 8px;
  text-align: left;
}
.snapshot-table th {
  color: #69758c;
  font-weight: 600;
  background: #f6f9fc;
}
.num { text-align: right; font-variant-numeric: tabular-nums; }
.delta.up { color: #c84b31; font-weight: 700; }
.delta.down { color: #14724f; font-weight: 700; }
.delta.flat { color: #8a94a8; }
.compact th, .compact td { padding: 5px 8px; }
</style>
