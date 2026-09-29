import { defineStore } from "pinia";
import { ref } from "vue";
import {
  FUELS,
  type FlowState,
  type Fuel,
  type PriceOrder,
  type PriceSnapshot,
  type PriceVersion,
  type RollbackRecord
} from "./types";

const STORAGE_KEY = "dfwlfront-9-price-flow-v1";

export const DEFAULT_SNAPSHOT: PriceSnapshot = {
  "92号汽油": 7.62,
  "95号汽油": 8.11,
  "98号汽油": 9.03,
  "柴油": 7.18
};

export function cloneSnapshot(snapshot: PriceSnapshot): PriceSnapshot {
  return { ...snapshot };
}

export function snapshotsEqual(a: PriceSnapshot, b: PriceSnapshot): boolean {
  return FUELS.every((fuel) => a[fuel] === b[fuel]);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function latestOf<T>(list: readonly T[]): T {
  return list[list.length - 1];
}

function seedState(): FlowState {
  const now = new Date().toISOString();
  const baseline: PriceVersion = {
    version: 1,
    snapshot: cloneSnapshot(DEFAULT_SNAPSHOT),
    source: "baseline",
    operator: "系统",
    effectiveDate: "2026-06-30",
    createdAt: now,
    comment: "挂牌价基线"
  };
  // 一条已发布版本，让初始列表里就有完整的审批与版本链路
  const v2Snapshot: PriceSnapshot = {
    ...cloneSnapshot(DEFAULT_SNAPSHOT),
    "92号汽油": 7.72,
    "柴油": 7.25
  };
  const v2: PriceVersion = {
    version: 2,
    snapshot: v2Snapshot,
    source: "approval",
    operator: "主管·王敏",
    orderCode: "TJ-20260629-001",
    effectiveDate: "2026-06-30",
    createdAt: now,
    comment: "夜班批发联动调价"
  };
  const seedOrder: PriceOrder = {
    id: crypto.randomUUID(),
    code: "TJ-20260629-001",
    status: "approved",
    snapshot: cloneSnapshot(v2Snapshot),
    submitter: "站长·李强",
    submittedAt: now,
    baseVersion: 1,
    note: "随批发价上调 92 号汽油与柴油",
    reviewer: "主管·王敏",
    reviewComment: "符合调价幅度要求",
    reviewedAt: now,
    publishedVersion: 2
  };
  return { rev: 1, versions: [baseline, v2], orders: [seedOrder], rollbacks: [], orderSeq: 1 };
}

function loadState(): FlowState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw) as FlowState;
    if (!Array.isArray(parsed.versions) || parsed.versions.length === 0) return seedState();
    return {
      rev: parsed.rev ?? 1,
      versions: parsed.versions,
      orders: parsed.orders ?? [],
      rollbacks: parsed.rollbacks ?? [],
      orderSeq: parsed.orderSeq ?? parsed.orders.length + 1
    };
  } catch {
    return seedState();
  }
}

export interface SubmitInput {
  snapshot: PriceSnapshot;
  submitter: string;
  effectiveDate: string;
  note: string;
}

export interface ReviewInput {
  orderId: string;
  reviewer: string;
  comment: string;
  effectiveDate: string;
  /** 页面打开审批弹窗时读到的 rev；提交时若已变化说明另一班刚发过版 */
  expectedRev: number;
}

export interface RollbackInput {
  targetVersion: number;
  operator: string;
  reason: string;
  effectiveDate: string;
  /** 打开回滚面板时的 rev；执行时若已变化，提示先看最新版本 */
  expectedRev: number;
}

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: "stale"; currentRev: number; latestVersion: number };

export const usePriceStore = defineStore("priceFlow", () => {
  const state = ref<FlowState>(loadState());

  function syncFromStorage() {
    state.value = loadState();
  }

  const latestVersion = ref<PriceVersion>(latestOf(state.value.versions));
  const currentSnapshot = ref<PriceSnapshot>(cloneSnapshot(latestVersion.value.snapshot));

  function refreshDerived() {
    const versions = state.value.versions;
    latestVersion.value = latestOf(versions);
    currentSnapshot.value = cloneSnapshot(latestVersion.value.snapshot);
  }
  refreshDerived();

  /** 其他标签页（白班/夜班）写入后同步 */
  function onStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) {
      syncFromStorage();
      refreshDerived();
    }
  }
  window.addEventListener("storage", onStorage);

  /** 站长提交调价单：固定当时价格快照与基线版本，进入待复核 */
  function submitOrder(input: SubmitInput): PriceOrder {
    const fresh = loadState();
    const seq = fresh.orderSeq + 1;
    const code = `TJ-${today().split("-").join("")}-${String(seq).padStart(3, "0")}`;
    const order: PriceOrder = {
      id: crypto.randomUUID(),
      code,
      status: "pending",
      snapshot: cloneSnapshot(input.snapshot),
      submitter: input.submitter || "站长",
      submittedAt: new Date().toISOString(),
      baseVersion: latestOf(fresh.versions).version,
      note: input.note || "暂无备注",
      reviewComment: undefined
    };
    fresh.orders.unshift(order);
    fresh.orderSeq = seq;
    fresh.rev += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    syncFromStorage();
    refreshDerived();
    return order;
  }

  /**
   * 主管通过：按调价单里提交时的价格快照生成新版本。
   * 若期间已有另一张单发版（baseVersion 落后），保留原审批意见，
   * 单据标记为版本冲突，不用旧快照覆盖新版本。
   */
  function approveOrder(input: ReviewInput): ActionResult {
    const fresh = loadState();
    const order = fresh.orders.find((item) => item.id === input.orderId);
    if (!order) return { ok: false, reason: "stale", currentRev: fresh.rev, latestVersion: latestOf(fresh.versions).version };

    const reviewer = input.reviewer || "主管";
    const comment = input.comment || "同意";
    const currentVersionNo = latestOf(fresh.versions).version;

    // 不论是否冲突，都把复核人与意见留在单据上
    if (order.status === "pending") {
      order.reviewer = reviewer;
      order.reviewComment = comment;
      order.reviewedAt = new Date().toISOString();
    }

    if (fresh.rev !== input.expectedRev || order.baseVersion !== currentVersionNo) {
      // 另一班在本单提交后已经发版/回滚：标记冲突、保留意见，绝不用旧快照覆盖
      if (order.status === "pending" && order.baseVersion !== currentVersionNo) {
        order.status = "conflicted";
        order.conflictVersion = currentVersionNo;
      }
      fresh.rev += 1;
      persistFresh(fresh);
      return { ok: false, reason: "stale", currentRev: fresh.rev, latestVersion: currentVersionNo };
    }

    const newVersion: PriceVersion = {
      version: currentVersionNo + 1,
      snapshot: cloneSnapshot(order.snapshot),
      source: "approval",
      operator: reviewer,
      orderCode: order.code,
      effectiveDate: input.effectiveDate || today(),
      createdAt: new Date().toISOString(),
      comment
    };
    fresh.versions.push(newVersion);
    order.status = "approved";
    order.publishedVersion = newVersion.version;
    fresh.rev += 1;
    persistFresh(fresh);
    return { ok: true };
  }

  /** 主管驳回：只更新单据，不发版；并发变化时同样提示 */
  function rejectOrder(input: ReviewInput): ActionResult {
    const fresh = loadState();
    const order = fresh.orders.find((item) => item.id === input.orderId);
    if (!order) return { ok: false, reason: "stale", currentRev: fresh.rev, latestVersion: latestOf(fresh.versions).version };
    if (fresh.rev !== input.expectedRev) {
      return { ok: false, reason: "stale", currentRev: fresh.rev, latestVersion: latestOf(fresh.versions).version };
    }
    order.status = "rejected";
    order.reviewer = input.reviewer || "主管";
    order.reviewComment = input.comment || "不同意";
    order.reviewedAt = new Date().toISOString();
    fresh.rev += 1;
    persistFresh(fresh);
    return { ok: true };
  }

  /**
   * 回滚：按目标版本“审批时的快照”原样生成新版本。
   * 快照取自版本记录本身，不受之后任何价格改动影响。
   */
  function rollback(input: RollbackInput): ActionResult {
    const fresh = loadState();
    if (fresh.rev !== input.expectedRev) {
      return { ok: false, reason: "stale", currentRev: fresh.rev, latestVersion: latestOf(fresh.versions).version };
    }
    const target = fresh.versions.find((v) => v.version === input.targetVersion);
    const current = latestOf(fresh.versions);
    if (!target || target.version === current.version) {
      return { ok: false, reason: "stale", currentRev: fresh.rev, latestVersion: current.version };
    }
    const newVersion: PriceVersion = {
      version: current.version + 1,
      snapshot: cloneSnapshot(target.snapshot),
      source: "rollback",
      operator: input.operator || "主管",
      orderCode: target.orderCode,
      rollbackFromVersion: current.version,
      effectiveDate: input.effectiveDate || today(),
      createdAt: new Date().toISOString(),
      comment: `回滚至 v${target.version}：${input.reason || "未填原因"}`
    };
    const record: RollbackRecord = {
      id: crypto.randomUUID(),
      fromVersion: current.version,
      toVersion: target.version,
      operator: input.operator || "主管",
      reason: input.reason || "未填原因",
      effectiveDate: newVersion.effectiveDate,
      createdAt: newVersion.createdAt,
      newVersion: newVersion.version
    };
    fresh.versions.push(newVersion);
    fresh.rollbacks.unshift(record);
    fresh.rev += 1;
    persistFresh(fresh);
    return { ok: true };
  }

  function persistFresh(fresh: FlowState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    syncFromStorage();
    refreshDerived();
  }

  /** 页面刚打开旧单弹窗时调用：拿最新 rev 作为本次操作的乐观锁基准 */
  function currentRev(): number {
    return loadState().rev;
  }

  function versionAt(version: number): PriceVersion | undefined {
    return state.value.versions.find((v) => v.version === version);
  }

  function resetDemo() {
    const seeded = seedState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    syncFromStorage();
    refreshDerived();
  }

  return {
    state,
    latestVersion,
    currentSnapshot,
    submitOrder,
    approveOrder,
    rejectOrder,
    rollback,
    currentRev,
    versionAt,
    snapshotsEqual,
    resetDemo,
    syncFromStorage,
    refreshDerived
  };
});

export type FuelKey = Fuel;
