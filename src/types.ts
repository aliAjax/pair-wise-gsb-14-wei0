export type Fuel = "92号汽油" | "95号汽油" | "98号汽油" | "柴油";

export const FUELS: readonly Fuel[] = ["92号汽油", "95号汽油", "98号汽油", "柴油"];

/** 某一时刻全部油品的挂牌价快照，版本与回滚都以它为准 */
export type PriceSnapshot = Record<Fuel, number>;

export type Role = "station_manager" | "supervisor";

export type OrderStatus = "pending" | "approved" | "rejected" | "conflict";

/** 调价审批单：只追加、不就地覆盖，复核意见随单据长期保留 */
export interface PriceOrder {
  id: string;
  fuel: Fuel;
  /** 站长提交时的申请价格，审批发布时按此价格生成快照 */
  submittedPrice: number;
  /** 提交时所依据的价格版本号，用于乐观锁检测 */
  baseVersionNo: number;
  submitter: string;
  submittedAt: string;
  effectiveDate: string;
  note: string;
  status: OrderStatus;
  /** 主管复核意见 */
  reviewComment: string;
  reviewer: string;
  reviewedAt: string;
  /** 通过后生成的版本号；冲突时记录对方已发布的版本号 */
  publishedVersionNo: number | null;
  conflictedWithVersionNo: number | null;
  /** 冲突后重新挂账的新审批单 */
  rebasedToOrderId: string | null;
}

export type VersionKind = "adjust" | "rollback";

/** 价格版本：不可变。调价通过与回滚都会生成新版本 */
export interface PriceVersion {
  no: number;
  kind: VersionKind;
  snapshot: PriceSnapshot;
  /** 产生本版本的审批单（回滚版本同样有审批留痕） */
  sourceOrderId: string;
  operator: string;
  reviewer: string;
  effectiveDate: string;
  createdAt: string;
  note: string;
  /** 回滚版本指向恢复的目标版本号 */
  restoredFromVersionNo: number | null;
  /** 被回滚撤下的原版本号 */
  rolledBackVersionNo: number | null;
}

export interface RollbackRecord {
  id: string;
  /** 触发回滚的审批单 */
  orderId: string;
  /** 新生成的版本号 */
  newVersionNo: number;
  /** 恢复到的历史版本号 */
  restoredFromVersionNo: number;
  /** 当时被撤下的版本号 */
  rolledBackVersionNo: number;
  snapshot: PriceSnapshot;
  operator: string;
  reason: string;
  createdAt: string;
}

export interface PriceState {
  version: 1;
  orders: PriceOrder[];
  versions: PriceVersion[];
  rollbacks: RollbackRecord[];
}
