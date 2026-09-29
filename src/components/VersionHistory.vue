<script setup lang="ts">
import { computed, ref } from "vue";
import type { PriceVersion } from "../types";
import { usePriceStore } from "../store";
import SnapshotTable from "./SnapshotTable.vue";

const store = usePriceStore();

const versions = computed(() => [...store.state.versions].reverse());
const rollbacks = computed(() => store.state.rollbacks);

// 回滚弹窗
const target = ref<PriceVersion | null>(null);
const operator = ref("主管·王敏");
const reason = ref("");
const effectiveDate = ref(new Date().toISOString().slice(0, 10));
const expectedRev = ref(0);
const errorMsg = ref("");

const sourceMap = { baseline: "基线", approval: "审批发版", rollback: "回滚恢复" } as const;

function openRollback(version: PriceVersion) {
  target.value = version;
  reason.value = "";
  effectiveDate.value = new Date().toISOString().slice(0, 10);
  expectedRev.value = store.currentRev();
  errorMsg.value = "";
}

function closeRollback() {
  target.value = null;
}

function confirmRollback() {
  if (!target.value) return;
  errorMsg.value = "";
  const result = store.rollback({
    targetVersion: target.value.version,
    operator: operator.value.trim(),
    reason: reason.value.trim(),
    effectiveDate: effectiveDate.value,
    expectedRev: expectedRev.value
  });
  if (result.ok) {
    closeRollback();
    return;
  }
  expectedRev.value = result.currentRev;
  errorMsg.value =
    `回滚前价格版本已变化（当前 v${result.latestVersion}），为避免覆盖另一班的操作，请关闭后按最新版本重新选择回滚目标。`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function targetBase(): PriceVersion | undefined {
  if (!target.value) return undefined;
  // 回滚不与任何价格联动：只展示目标快照本身，基准仅用于看价差
  return versions.value.find((v) => v.version === store.latestVersion.version);
}
</script>

<template>
  <section class="panel history-panel">
    <h2>价格版本</h2>
    <p class="hint">每次主管通过或回滚都追加一个不可修改的新版本，快照即审批/回滚那一刻的价格。</p>

    <div class="timeline">
      <article v-for="version in versions" :key="version.version" class="version" :class="version.source">
        <header>
          <div class="v-title">
            <span class="v-no">v{{ version.version }}</span>
            <span class="v-source">{{ sourceMap[version.source] }}</span>
            <span v-if="version.version === store.latestVersion.version" class="current-tag">生效中</span>
          </div>
          <button
            v-if="version.version !== store.latestVersion.version"
            type="button"
            class="secondary small"
            @click="openRollback(version)"
          >
            回滚到此版本
          </button>
        </header>
        <p class="v-meta">
          {{ version.operator }} ｜ 生效 {{ version.effectiveDate }} ｜ {{ fmtTime(version.createdAt) }}
          <template v-if="version.orderCode"> ｜ 单据 {{ version.orderCode }}</template>
        </p>
        <p v-if="version.comment" class="v-comment">{{ version.comment }}</p>
        <SnapshotTable :snapshot="version.snapshot" compact />
      </article>
    </div>

    <h2 class="rb-title">回滚记录</h2>
    <div v-if="rollbacks.length === 0" class="empty">暂无回滚记录</div>
    <table v-else class="rb-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>操作人</th>
          <th>回滚路径</th>
          <th>生效日期</th>
          <th>原因</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="rb in rollbacks" :key="rb.id">
          <td>{{ fmtTime(rb.createdAt) }}</td>
          <td>{{ rb.operator }}</td>
          <td>v{{ rb.fromVersion }} → v{{ rb.toVersion }}（新发 v{{ rb.newVersion }}）</td>
          <td>{{ rb.effectiveDate }}</td>
          <td>{{ rb.reason }}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <div v-if="target" class="modal-mask" @click.self="closeRollback">
    <div class="modal">
      <header class="modal-head">
        <div>
          <p class="eyebrow">回滚价格</p>
          <h3>恢复 v{{ target.version }} 的审批快照</h3>
        </div>
        <button type="button" class="icon-btn secondary" @click="closeRollback">✕</button>
      </header>

      <div class="warn">
        回滚会以 v{{ target.version }} 当时的价格快照<b>生成新版本 v{{ store.latestVersion.version + 1 }}</b>，
        不会修改任何历史版本，也不受这之后价格改动影响。
      </div>

      <SnapshotTable :snapshot="target.snapshot" :baseline="targetBase()?.snapshot" compact />

      <div class="form-row">
        <label>
          操作人
          <input v-model="operator" required />
        </label>
        <label>
          生效日期
          <input v-model="effectiveDate" type="date" required />
        </label>
      </div>
      <label class="reason-label">
        回滚原因
        <textarea v-model="reason" rows="2" placeholder="将记入回滚记录" required />
      </label>

      <div v-if="errorMsg" class="error">{{ errorMsg }}</div>

      <footer class="modal-actions">
        <button type="button" class="secondary" @click="closeRollback">取消</button>
        <button type="button" :disabled="!reason.trim()" @click="confirmRollback">确认回滚并发版</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.history-panel { margin-top: 16px; }
h2 { margin: 0 0 10px; font-size: 20px; }
.hint { margin: 0 0 14px; color: #69758c; font-size: 13px; }
.timeline { display: grid; gap: 12px; }
.version {
  border: 1px solid #dfe7f1;
  border-left: 4px solid #176b87;
  border-radius: 10px;
  padding: 12px 14px;
  background: #fbfcfe;
}
.version.baseline { border-left-color: #8a94a8; }
.version.rollback { border-left-color: #b3541e; }
.version header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.v-title { display: flex; align-items: center; gap: 8px; }
.v-no { font-weight: 800; font-size: 15px; }
.v-source {
  font-size: 12px;
  background: #eef5fb;
  color: #176b87;
  border-radius: 999px;
  padding: 2px 9px;
}
.version.rollback .v-source { background: #fdf0e6; color: #b3541e; }
.version.baseline .v-source { background: #eef2f7; color: #5b667a; }
.current-tag {
  font-size: 12px;
  background: #e8f4ef;
  color: #14724f;
  border-radius: 999px;
  padding: 2px 9px;
}
.v-meta { margin: 6px 0; color: #69758c; font-size: 12px; }
.v-comment {
  margin: 0 0 8px;
  font-size: 13px;
  color: #445069;
  background: #f6f9fc;
  border-radius: 8px;
  padding: 7px 10px;
}
.small { padding: 6px 10px; font-size: 12px; }
.rb-title { margin-top: 20px; }
.rb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rb-table th, .rb-table td {
  border-bottom: 1px solid #e7edf4;
  padding: 8px;
  text-align: left;
  color: #445069;
}
.rb-table th { color: #69758c; background: #f6f9fc; }
.empty { color: #69758c; text-align: center; padding: 18px; font-size: 13px; }

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
.modal-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.eyebrow { margin: 0 0 4px; color: #176b87; font-weight: 700; font-size: 12px; }
h3 { margin: 0; font-size: 17px; }
.icon-btn { padding: 6px 10px; }
.warn {
  background: #fdf0e6;
  color: #b3541e;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
  margin-bottom: 12px;
}
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 12px 0; }
.reason-label { display: grid; gap: 6px; color: #445069; font-size: 13px; }
.error {
  margin-top: 12px;
  background: #fdece8;
  border: 1px solid #f3c3b6;
  color: #a33b22;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
