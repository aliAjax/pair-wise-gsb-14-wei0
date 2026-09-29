import { defineStore } from "pinia";
import type {
  Fuel,
  OrderStatus,
  PriceOrder,
  PriceSnapshot,
  PriceState,
  PriceVersion,
  RollbackRecord
} from "./types";
import { FUELS } from "./types";

const STORAGE_KEY = "dfwlfront-9-price-flow";

function cloneSnapshot(snapshot: PriceSnapshot): PriceSnapshot {
  return { ...snapshot };
}

/** 初始基线价格（版本 1） */
function seedSnapshot(): PriceSnapshot {
  return {
    "92号汽油": 7.62,
    "95号汽油": 8.11,
    "98号汽油": 9.05,
    柴油: 7.18
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function seedState(): PriceState {
  const createdAt = new Date().toISOString();
  const baseline: PriceVersion = {
    no: 1,
    kind: "adjust",
    snapshot: seedSnapshot(),
    sourceOrderId: "",
    operator: "系统",
    reviewer: "系统",
    effectiveDate: "2026-06-30",
    createdAt,
    note: "初始挂牌价基线",
    restoredFromVersionNo: null,
    rolledBackVersionNo: null
  };
  return {
    version: 1,
    orders: [],
    versions: [baseline],
    rollbacks: []
  };
}

function loadState(): PriceState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw) as PriceState;
    if (!Array.isArray(parsed.versions) || parsed.versions.length === 0) return seedState();
    return parsed;
  } catch {
    return seedState();
  }
}

export interface SubmitInput {
  fuel: Fuel;
  price: number;
  submitter: string;
  effectiveDate: string;
  note: string;
}

export interface ReviewInput {
  orderId: string;
  approve: boolean;
  reviewer: string;
  comment: string;
  effectiveDate: string;
}

export interface RollbackInput {
  /** 撤下哪个版本（必须是当前生效版本） */
  rolledBackVersionNo: number;
  /** 恢复到哪个历史版本的审批时快照 */
  restoredFromVersionNo: number;
  operator: string;
  reason: string;
}

export const usePriceStore = defineStore("price", {
  state: (): PriceState => loadState(),

  getters: {
    currentVersion(state): PriceVersion {
      return state.versions[state.versions.length - 1];
    },
    currentSnapshot(): PriceSnapshot {
      return cloneSnapshot(this.currentVersion.snapshot);
    },
    pendingOrders(state): PriceOrder[] {
      return state.orders.filter((order) => order.status === "pending");
    }
  },

  actions: {
    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state));
    },

    resetAll() {
      Object.assign(this.$state, seedState());
      this.persist();
    },

    /** 站长提交调价单：记录提交时的版本号与申请价格，进入待复核 */
    submitOrder(input: SubmitInput): PriceOrder {
      const order: PriceOrder = {
        id: crypto.randomUUID(),
        fuel: input.fuel,
        submittedPrice: input.price,
        baseVersionNo: this.currentVersion.no,
        submitter: input.submitter || "站长",
        submittedAt: new Date().toISOString(),
        effectiveDate: input.effectiveDate || today(),
        note: input.note,
        status: "pending",
        reviewComment: "",
        reviewer: "",
        reviewedAt: "",
        publishedVersionNo: null,
        conflictedWithVersionNo: null,
        rebasedToOrderId: null
      };
      this.orders.unshift(order);
      this.persist();
      return order;
    },

    /**
     * 主管复核。
     * 通过时按审批单里提交的价格快照生成新版本（乐观锁）：
     * 若提交所依据的版本已不是当前版本（另一班已发布），判定为冲突，
     * 保留原审批意见与申请内容，不覆盖新价格。
     */
    reviewOrder(input: ReviewInput): { ok: boolean; reason?: string; versionNo?: number } {
      const order = this.orders.find((item) => item.id === input.orderId);
      if (!order) return { ok: false, reason: "审批单不存在" };
      if (order.status !== "pending") return { ok: false, reason: "该审批单已处理" };

      const reviewedAt = new Date().toISOString();
      order.reviewer = input.reviewer || "主管";
      order.reviewComment = input.comment;
      order.reviewedAt = reviewedAt;

      if (!input.approve) {
        order.status = "rejected";
        this.persist();
        return { ok: true };
      }

      // 乐观锁：提交依据版本必须仍是最新版本，否则是另一窗口拿旧单提交
      if (order.baseVersionNo !== this.currentVersion.no) {
        order.status = "conflict";
        order.conflictedWithVersionNo = this.currentVersion.no;
        this.persist();
        return {
          ok: false,
          reason: `价格已变化：提交依据版本 v${order.baseVersionNo}，当前已发布 v${this.currentVersion.no}，审批意见已保留，未覆盖对方发布的价格`
        };
      }

      const effectiveDate = input.effectiveDate || order.effectiveDate;
      const snapshot = cloneSnapshot(this.currentVersion.snapshot);
      snapshot[order.fuel] = order.submittedPrice;

      const versionNo = this.currentVersion.no + 1;
      const version: PriceVersion = {
        no: versionNo,
        kind: "adjust",
        snapshot,
        sourceOrderId: order.id,
        operator: order.submitter,
        reviewer: order.reviewer,
        effectiveDate,
        createdAt: reviewedAt,
        note: order.note,
        restoredFromVersionNo: null,
        rolledBackVersionNo: null
      };
      this.versions.push(version);

      order.status = "approved";
      order.publishedVersionNo = versionNo;
      order.effectiveDate = effectiveDate;
      this.persist();
      return { ok: true, versionNo };
    },

    /**
     * 冲突单据重新挂账：以当前版本为新依据再走一次审批。
     * 原单据及其审批意见保留不动，生成一张新的待复核单。
     */
    rebaseOrder(oldOrderId: string): PriceOrder | null {
      const old = this.orders.find((item) => item.id === oldOrderId);
      if (!old || old.status !== "conflict") return null;
      const order: PriceOrder = {
        id: crypto.randomUUID(),
        fuel: old.fuel,
        submittedPrice: old.submittedPrice,
        baseVersionNo: this.currentVersion.no,
        submitter: old.submitter,
        submittedAt: new Date().toISOString(),
        effectiveDate: old.effectiveDate,
        note: old.note,
        status: "pending",
        reviewComment: "",
        reviewer: "",
        reviewedAt: "",
        publishedVersionNo: null,
        conflictedWithVersionNo: null,
        rebasedToOrderId: null
      };
      old.rebasedToOrderId = order.id;
      this.orders.unshift(order);
      this.persist();
      return order;
    },

    /**
     * 回滚：恢复目标版本在审批发布时的价格快照，生成一个不可变新版本。
     * 快照取自版本记录本身，因此不受版本生成之后任何价格改动影响。
     */
    rollback(input: RollbackInput): { ok: boolean; reason?: string; record?: RollbackRecord } {
      const current = this.currentVersion;
      if (input.rolledBackVersionNo !== current.no) {
        return { ok: false, reason: `当前生效版本是 v${current.no}，只能先撤下当前版本` };
      }
      const target = this.versions.find((v) => v.no === input.restoredFromVersionNo);
      if (!target) return { ok: false, reason: "目标版本不存在" };
      if (target.no === current.no) return { ok: false, reason: "目标版本就是当前版本，无需回滚" };

      const createdAt = new Date().toISOString();
      const versionNo = current.no + 1;
      const snapshot = cloneSnapshot(target.snapshot);

      const version: PriceVersion = {
        no: versionNo,
        kind: "rollback",
        snapshot,
        sourceOrderId: "",
        operator: input.operator || "主管",
        reviewer: input.operator || "主管",
        effectiveDate: today(),
        createdAt,
        note: input.reason || `回滚恢复 v${target.no} 审批时快照`,
        restoredFromVersionNo: target.no,
        rolledBackVersionNo: current.no
      };
      this.versions.push(version);

      const record: RollbackRecord = {
        id: crypto.randomUUID(),
        orderId: "",
        newVersionNo: versionNo,
        restoredFromVersionNo: target.no,
        rolledBackVersionNo: current.no,
        snapshot,
        operator: version.operator,
        reason: version.note,
        createdAt
      };
      this.rollbacks.unshift(record);
      this.persist();
      return { ok: true, record };
    },

    /** 同步另一窗口/另一班写入的最新数据（跨标签页 storage 事件） */
    syncFromStorage() {
      const latest = loadState();
      Object.assign(this.$state, latest);
    },

    statusLabel(status: OrderStatus): string {
      return STATUS_LABELS[status];
    }
  }
});

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待复核",
  approved: "已通过",
  rejected: "已驳回",
  conflict: "版本冲突"
};

export { FUELS, today };
