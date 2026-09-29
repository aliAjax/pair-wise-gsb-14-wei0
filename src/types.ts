// 调价流程领域模型：调价单、价格版本、回滚记录
// 所有写入都带价格版本号做乐观并发控制，防止白班/夜班互相覆盖。

export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;
export type Fuel = (typeof FUELS)[number];

/** 一张价目表的价格快照：任一版本里各油品的挂牌价 */
export type PriceSnapshot = Record<Fuel, number>;

/** 调价单状态 */
export type OrderStatus = "pending" | "approved" | "rejected" | "conflicted";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "待复核",
  approved: "已通过",
  rejected: "已驳回",
  conflicted: "版本冲突"
};

/** 调价单：站长提交，主管复核 */
export interface PriceOrder {
  id: string;
  code: string;
  status: OrderStatus;
  /** 提交时的价格快照，审批时按此快照发版，提交后不再变动 */
  snapshot: PriceSnapshot;
  /** 提交人（站长） */
  submitter: string;
  submittedAt: string;
  /** 提交时基于的版本号；审批时必须仍是最新版本才允许发版 */
  baseVersion: number;
  note: string;
  /** 复核信息：复核人、意见、复核时间——冲突时也原样保留 */
  reviewer?: string;
  reviewComment?: string;
  reviewedAt?: string;
  /** 通过后生成的版本号 */
  publishedVersion?: number;
  /** 冲突时当前最新版本号与复核时的快照，供页面比对 */
  conflictVersion?: number;
}

/** 价格版本：主管通过或回滚时追加生成，一经生成不可修改 */
export interface PriceVersion {
  version: number;
  snapshot: PriceSnapshot;
  /** 来源：审批通过 / 回滚 / 基线 */
  source: "baseline" | "approval" | "rollback";
  operator: string;
  /** 审批单编号（审批/回滚产生时） */
  orderCode?: string;
  /** 回滚自哪个版本（回滚产生时） */
  rollbackFromVersion?: number;
  effectiveDate: string;
  createdAt: string;
  comment?: string;
}

/** 回滚记录 */
export interface RollbackRecord {
  id: string;
  fromVersion: number;
  toVersion: number;
  operator: string;
  reason: string;
  effectiveDate: string;
  createdAt: string;
  newVersion: number;
}

export interface FlowState {
  /** 单调递增的乐观并发令牌，每次提交 +1 */
  rev: number;
  versions: PriceVersion[];
  orders: PriceOrder[];
  rollbacks: RollbackRecord[];
  orderSeq: number;
}
