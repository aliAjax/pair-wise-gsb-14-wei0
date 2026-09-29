<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { STATUS_LABELS, FUELS, today, usePriceStore } from "./store";
import type { Fuel, PriceOrder, PriceVersion } from "./types";

const store = usePriceStore();

const project = {
  industry: "石油",
  title: "油品价格维护",
  subtitle: "调价单经主管复核后按提交快照发布新版本；版本不可变，回滚恢复审批时快照；旧单复核时自动识别版本冲突。",
  stack: ["Vue3", "Vite", "TypeScript", "Pinia"] as const
};

/* ---------------- 站长提交调价单 ---------------- */

const form = reactive<{
  fuel: Fuel;
  price: number;
  submitter: string;
  effectiveDate: string;
  note: string;
}>({
  fuel: FUELS[0],
  price: store.currentSnapshot[FUELS[0]],
  submitter: "站长",
  effectiveDate: today(),
  note: ""
});

watch(
  () => form.fuel,
  (fuel) => {
    form.price = store.currentSnapshot[fuel];
  }
);

const banner = reactive<{ type: "info" | "ok" | "error"; text: string }>({
  type: "info",
  text: "白班 / 夜班请分别提交调价单，由主管复核后发布，不再直接改价格列表。"
});

function notify(type: "info" | "ok" | "error", text: string) {
  banner.type = type;
  banner.text = text;
}

function submitOrder() {
  if (!Number.isFinite(form.price) || form.price <= 0) {
    notify("error", "请输入有效的挂牌价");
    return;
  }
  const baseNo = store.currentVersion.no;
  const order = store.submitOrder({
    fuel: form.fuel,
    price: Number(form.price.toFixed(2)),
    submitter: form.submitter,
    effectiveDate: form.effectiveDate,
    note: form.note
  });
  notify("ok", `调价单已提交，依据版本 v${baseNo}，等待主管复核（单号 ${order.id.slice(0, 8)}）`);
  form.note = "";
  form.price = store.currentSnapshot[form.fuel];
}

/* ---------------- 主管复核 ---------------- */

const reviewDrafts = reactive<Record<string, { reviewer: string; comment: string; effectiveDate: string }>>({});

function ensureDraft(order: PriceOrder) {
  if (!reviewDrafts[order.id]) {
    reviewDrafts[order.id] = {
      reviewer: "主管",
      comment: order.reviewComment,
      effectiveDate: order.effectiveDate
    };
  }
  return reviewDrafts[order.id];
}

function review(order: PriceOrder, approve: boolean) {
  const draft = ensureDraft(order);
  if (approve && !draft.effectiveDate) {
    notify("error", "请填写生效日期");
    return;
  }
  const result = store.reviewOrder({
    orderId: order.id,
    approve,
    reviewer: draft.reviewer,
    comment: draft.comment,
    effectiveDate: draft.effectiveDate
  });
  if (result.ok) {
    notify(
      "ok",
      approve
        ? `已通过，按提交快照发布新版本 v${result.versionNo}，操作人 ${order.submitter}，生效日期 ${draft.effectiveDate}`
        : "已驳回，审批意见已保留在单据上"
    );
  } else {
    notify("error", result.reason || "复核失败");
  }
}

function rebase(order: PriceOrder) {
  const created = store.rebaseOrder(order.id);
  if (created) {
    notify("ok", `已按当前版本 v${created.baseVersionNo} 重新挂账生成新待复核单，原单据与审批意见保留`);
  }
}

/* ---------------- 回滚 ---------------- */

const rollbackDraft = reactive<{ targetNo: number | null; operator: string; reason: string }>({
  targetNo: null,
  operator: "主管",
  reason: ""
});

function startRollback(version: PriceVersion) {
  rollbackDraft.targetNo = version.no;
  rollbackDraft.operator = "主管";
  rollbackDraft.reason = `撤下 v${store.currentVersion.no}，恢复 v${version.no} 审批时价格快照`;
}

function confirmRollback() {
  if (rollbackDraft.targetNo == null) return;
  const result = store.rollback({
    rolledBackVersionNo: store.currentVersion.no,
    restoredFromVersionNo: rollbackDraft.targetNo,
    operator: rollbackDraft.operator,
    reason: rollbackDraft.reason
  });
  if (result.ok && result.record) {
    notify(
      "ok",
      `已回滚：撤下 v${result.record.rolledBackVersionNo}，恢复 v${result.record.restoredFromVersionNo} 的审批快照，生成新版本 v${result.record.newVersionNo}`
    );
  } else {
    notify("error", result.reason || "回滚失败");
  }
  rollbackDraft.targetNo = null;
}

/* ---------------- 列表与视图数据 ---------------- */

type OrderFilter = "pending" | "all" | "conflict";
const orderFilter = ref<OrderFilter>("pending");

const visibleOrders = computed(() => {
  if (orderFilter.value === "pending") return store.orders.filter((o) => o.status === "pending");
  if (orderFilter.value === "conflict") return store.orders.filter((o) => o.status === "conflict");
  return store.orders;
});

const versionsDesc = computed(() => [...store.versions].reverse());

function priceChangedAfterSubmit(order: PriceOrder): boolean {
  return store.currentSnapshot[order.fuel] !== order.submittedPrice;
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 16);
}

const metrics = computed(() => [
  { label: "当前生效版本", value: `v${store.currentVersion.no}` },
  { label: "待复核调价单", value: store.pendingOrders.length },
  { label: "历史版本 / 回滚", value: `${store.versions.length} / ${store.rollbacks.length}` }
]);

const orderStatusRows = computed(() =>
  (["pending", "approved", "rejected", "conflict"] as const).map((status) => ({
    status: STATUS_LABELS[status],
    value: store.orders.filter((o) => o.status === status).length
  }))
);
const maxStatusCount = computed(() => Math.max(1, ...orderStatusRows.value.map((r) => r.value)));

/* ---------------- 跨窗口同步（白班/夜班可能开在不同标签页） ---------------- */

function onStorage(event: StorageEvent) {
  if (event.key?.includes("dfwlfront-9")) {
    store.syncFromStorage();
    notify("info", "检测到另一窗口已更新价格数据，列表已同步；旧单复核时仍会做版本校验。");
  }
}

onMounted(() => window.addEventListener("storage", onStorage));
onUnmounted(() => window.removeEventListener("storage", onStorage));
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <p class="banner" :class="banner.type">{{ banner.text }}</p>

      <section class="metrics">
        <article v-for="item in metrics" :key="item.label" class="metric">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <!-- 站长提交 -->
        <form class="panel" @submit.prevent="submitOrder">
          <h2>站长提交调价单</h2>
          <p class="hint">提交后进入「待复核」，不会直接改动现行价格。</p>
          <div class="form-grid">
            <label>
              油品
              <select v-model="form.fuel">
                <option v-for="fuel in FUELS" :key="fuel" :value="fuel">{{ fuel }}</option>
              </select>
            </label>
            <label>
              申请挂牌价（当前 {{ store.currentSnapshot[form.fuel] }}）
              <input v-model.number="form.price" type="number" step="0.01" min="0.01" required />
            </label>
            <label>
              提交人（操作人）
              <input v-model="form.submitter" required />
            </label>
            <label>
              申请生效日期
              <input v-model="form.effectiveDate" type="date" required />
            </label>
            <label>
              调价说明
              <textarea v-model="form.note" placeholder="例如：夜间批发价上调，白班挂牌价跟进" />
            </label>
            <button type="submit">提交待复核</button>
          </div>

          <div class="mini-chart">
            <div v-for="row in orderStatusRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxStatusCount) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>调价审批单</h2>
            <div class="tabs">
              <button
                type="button"
                class="tab"
                :class="{ active: orderFilter === 'pending' }"
                @click="orderFilter = 'pending'"
              >待复核</button>
              <button
                type="button"
                class="tab"
                :class="{ active: orderFilter === 'conflict' }"
                @click="orderFilter = 'conflict'"
              >版本冲突</button>
              <button
                type="button"
                class="tab"
                :class="{ active: orderFilter === 'all' }"
                @click="orderFilter = 'all'"
              >全部</button>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="visibleOrders.length === 0" class="empty">暂无匹配审批单</div>

            <article v-for="order in visibleOrders" :key="order.id" class="record" :class="`st-${order.status}`">
              <div class="record-head">
                <p class="record-title">
                  {{ order.fuel }}：{{ order.submittedPrice }}
                  <small class="mono">#{{ order.id.slice(0, 8) }}</small>
                </p>
                <span class="status" :class="`st-${order.status}`">{{ STATUS_LABELS[order.status] }}</span>
              </div>

              <div class="details">
                <span>提交人：{{ order.submitter }}</span>
                <span>提交时间：{{ fmtTime(order.submittedAt) }}</span>
                <span>依据版本：v{{ order.baseVersionNo }}</span>
                <span>申请生效：{{ order.effectiveDate }}</span>
                <span v-if="order.publishedVersionNo">发布版本：v{{ order.publishedVersionNo }}</span>
                <span v-if="order.conflictedWithVersionNo">对方已发布：v{{ order.conflictedWithVersionNo }}</span>
              </div>

              <p class="note">调价说明：{{ order.note || "无" }}</p>

              <div v-if="priceChangedAfterSubmit(order) && order.status === 'pending'" class="warn">
                注意：该油品申请价为 {{ order.submittedPrice }}（依据 v{{ order.baseVersionNo }}），当前生效价已变为 {{ store.currentSnapshot[order.fuel] }}。
                直接通过将按申请价发布，可能覆盖另一班刚发布的价格——请先与提交人核对，或驳回后由对方重新挂账。
              </div>

              <!-- 待复核：主管操作区 -->
              <div v-if="order.status === 'pending'" class="review-box">
                <div class="review-row">
                  <label>复核人<input v-model="ensureDraft(order).reviewer" /></label>
                  <label>生效日期<input v-model="ensureDraft(order).effectiveDate" type="date" /></label>
                </div>
                <label>复核意见<input v-model="ensureDraft(order).comment" placeholder="通过 / 驳回意见" /></label>
                <div class="actions">
                  <button type="button" @click="review(order, true)">通过并发布新版本</button>
                  <button class="danger" type="button" @click="review(order, false)">驳回</button>
                </div>
              </div>

              <!-- 冲突：保留原意见，可重新挂账 -->
              <div v-else-if="order.status === 'conflict'" class="conflict-box">
                <p>
                  本单依据 v{{ order.baseVersionNo }} 提交，复核时现行版本已是 v{{ order.conflictedWithVersionNo }}——
                  另一班已发布价格。系统未覆盖对方价格，原审批意见保留如下：
                </p>
                <p class="note">复核意见（{{ order.reviewer }}，{{ fmtTime(order.reviewedAt) }}）：{{ order.reviewComment || "无" }}</p>
                <div class="actions">
                  <button type="button" @click="rebase(order)">按当前版本重新挂账</button>
                  <button class="secondary" type="button" @click="orderFilter = 'all'">仅保留留痕</button>
                </div>
              </div>

              <!-- 已处理 -->
              <div v-else class="done-box">
                <span>复核人：{{ order.reviewer }} ｜ {{ fmtTime(order.reviewedAt) }}</span>
                <p class="note" v-if="order.reviewComment">复核意见：{{ order.reviewComment }}</p>
                <span v-if="order.rebasedToOrderId" class="hint">已重新挂账生成新单</span>
              </div>
            </article>
          </div>
        </section>
      </section>

      <!-- 当前生效价格 + 版本时间线 -->
      <section class="version-section">
        <div class="panel current-panel">
          <h2>当前生效价格 <small class="mono">v{{ store.currentVersion.no }}</small></h2>
          <p class="hint">
            {{ store.currentVersion.kind === "rollback" ? "回滚版本" : "调价版本" }}
            ｜操作人 {{ store.currentVersion.operator }}
            ｜复核人 {{ store.currentVersion.reviewer }}
            ｜生效日期 {{ store.currentVersion.effectiveDate }}
          </p>
          <div class="price-grid">
            <div v-for="fuel in FUELS" :key="fuel" class="price-card">
              <span>{{ fuel }}</span>
              <strong>{{ store.currentSnapshot[fuel] }}</strong>
            </div>
          </div>
        </div>

        <div class="list-panel">
          <div class="toolbar">
            <h2>价格版本（不可变）</h2>
            <span class="hint">回滚会复制目标版本审批时的快照生成新版本，不受之后改动影响</span>
          </div>
          <div class="version-list">
            <article v-for="version in versionsDesc" :key="version.no" class="version-row" :class="{ current: version.no === store.currentVersion.no }">
              <div class="version-head">
                <p class="record-title">
                  v{{ version.no }}
                  <span class="kind" :class="version.kind">{{ version.kind === "rollback" ? "回滚" : "调价" }}</span>
                  <small v-if="version.kind === 'rollback'" class="hint">
                    恢复 v{{ version.restoredFromVersionNo }}，撤下 v{{ version.rolledBackVersionNo }}
                  </small>
                </p>
                <span class="status">
                  {{ version.no === store.currentVersion.no ? "生效中" : "历史版本" }}
                </span>
              </div>
              <div class="snapshot">
                <span v-for="fuel in FUELS" :key="fuel">{{ fuel }} {{ version.snapshot[fuel] }}</span>
              </div>
              <div class="details">
                <span>操作人：{{ version.operator }}</span>
                <span>复核人：{{ version.reviewer }}</span>
                <span>生效日期：{{ version.effectiveDate }}</span>
                <span>发布时间：{{ fmtTime(version.createdAt) }}</span>
              </div>
              <p class="note" v-if="version.note">{{ version.note }}</p>

              <div v-if="rollbackDraft.targetNo === version.no" class="review-box">
                <div class="review-row">
                  <label>操作人<input v-model="rollbackDraft.operator" /></label>
                </div>
                <label>回滚原因<input v-model="rollbackDraft.reason" /></label>
                <div class="actions">
                  <button type="button" @click="confirmRollback">确认回滚并生成 v{{ store.currentVersion.no + 1 }}</button>
                  <button class="secondary" type="button" @click="rollbackDraft.targetNo = null">取消</button>
                </div>
              </div>
              <div v-else-if="version.no !== store.currentVersion.no" class="actions">
                <button class="secondary" type="button" @click="startRollback(version)">回滚到此版本快照</button>
              </div>
            </article>
          </div>
        </div>
      </section>

      <!-- 回滚记录 -->
      <section class="list-panel rollback-panel">
        <div class="toolbar">
          <h2>回滚记录</h2>
          <button class="secondary" type="button" @click="store.resetAll()">重置演示数据</button>
        </div>
        <div v-if="store.rollbacks.length === 0" class="empty">暂无回滚记录</div>
        <table v-else class="rollback-table">
          <thead>
            <tr>
              <th>时间</th><th>操作人</th><th>撤下版本</th><th>恢复版本</th><th>新版本</th><th>恢复快照</th><th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in store.rollbacks" :key="row.id">
              <td>{{ fmtTime(row.createdAt) }}</td>
              <td>{{ row.operator }}</td>
              <td>v{{ row.rolledBackVersionNo }}</td>
              <td>v{{ row.restoredFromVersionNo }}</td>
              <td>v{{ row.newVersionNo }}</td>
              <td class="snapshot-cell">
                <span v-for="fuel in FUELS" :key="fuel">{{ fuel }} {{ row.snapshot[fuel] }}；</span>
              </td>
              <td>{{ row.reason }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </main>
</template>
