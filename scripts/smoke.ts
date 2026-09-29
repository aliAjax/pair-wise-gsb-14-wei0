// 并发流程冒烟测试：模拟白班/夜班两个窗口
import { setActivePinia, createPinia } from "pinia";
import { usePriceStore } from "../src/store";
import { FUELS, type PriceSnapshot } from "../src/types";

let mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => {
    mem[k] = String(v);
  },
  removeItem: (k: string) => {
    delete mem[k];
  },
  clear: () => {
    mem = {};
  }
};
(globalThis as any).window = { addEventListener: () => {} };

setActivePinia(createPinia());
const store = usePriceStore();
store.resetDemo();

function snap(overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return { ...store.currentSnapshot, ...overrides };
}

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("✗ " + msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  passed++;
  console.log("✓ " + msg);
}

// 初始：v1 基线、v2 已审批发版
assert(store.latestVersion.version === 2, "初始最新版本为 v2");

// 1) 白班先提交 A 单（改 92 号汽油），夜班随后提交 B 单（改柴油），都基于 v2
const orderA = store.submitOrder({
  snapshot: snap({ "92号汽油": 8.88 }),
  submitter: "白班站长",
  effectiveDate: "2026-09-29",
  note: "白班调价 A"
});
const orderB = store.submitOrder({
  snapshot: snap({ "柴油": 6.66 }),
  submitter: "夜班站长",
  effectiveDate: "2026-09-29",
  note: "夜班调价 B"
});
assert(orderA.baseVersion === 2 && orderB.baseVersion === 2, "两张单都基于提交时的 v2 快照");

// 2) 夜班主管先打开 B 单弹窗，记下 rev；白班主管随后打开 A 单弹窗
const revAtBOpen = store.currentRev();
const revBeforeAOpen = store.currentRev();

// 夜班先通过 B
const resB = store.approveOrder({
  orderId: orderB.id,
  reviewer: "夜班主管",
  comment: "同意夜班",
  effectiveDate: "2026-09-30",
  expectedRev: revAtBOpen
});
assert(resB.ok, "夜班先复核 B 单成功");
assert(store.latestVersion.version === 3, "B 单发布 v3");
assert(store.latestVersion.snapshot["柴油"] === 6.66, "v3 按 B 单提交时的快照生成");
assert(store.latestVersion.operator === "夜班主管", "v3 记录操作人");
assert(store.latestVersion.effectiveDate === "2026-09-30", "v3 记录生效日期");

// 3) 白班拿着旧单 A、旧 rev 点通过 —— 模拟另一个窗口没有刷新
const staleRes = store.approveOrder({
  orderId: orderA.id,
  reviewer: "白班主管",
  comment: "同意白班",
  effectiveDate: "2026-09-30",
  expectedRev: revBeforeAOpen
});
assert(!staleRes.ok && staleRes.reason === "stale", "旧窗口提交 A 单被乐观锁拦截");
assert(store.latestVersion.version === 3, "A 单没有覆盖掉夜班刚发布的 v3");
assert(store.latestVersion.snapshot["柴油"] === 6.66, "v3 柴油价格仍是夜班发布的 6.66");

const aAfter = store.state.orders.find((o) => o.id === orderA.id)!;
assert(aAfter.status === "conflicted", "A 单标记为版本冲突");
assert(aAfter.reviewComment === "同意白班" && aAfter.reviewer === "白班主管", "原审批意见与复核人保留");
assert(aAfter.conflictVersion === 3, "冲突单记录对方版本 v3");
assert(aAfter.snapshot["92号汽油"] === 8.88, "A 单提交时快照仍冻结，未被改写");

// 即使旧窗口刷新后拿新 rev 再点通过，baseVersion 落后依旧拦截
const reopenedRev = store.currentRev();
const reapprove = store.approveOrder({
  orderId: orderA.id,
  reviewer: "白班主管",
  comment: "同意白班",
  effectiveDate: "2026-09-30",
  expectedRev: reopenedRev
});
assert(!reapprove.ok, "刷新后重试 A 单仍因基线版本落后被拦截");
assert(store.latestVersion.version === 3, "重试也不会覆盖 v3");

// 4) 回滚：恢复 v2 审批时快照，不受 v3 影响
const rbStale = store.rollback({
  targetVersion: 2,
  operator: "白班主管",
  reason: "价格异常",
  effectiveDate: "2026-09-30",
  expectedRev: reopenedRev
});
assert(!rbStale.ok, "回滚面板打开后版本有变化时同样拦截");

const rbOk = store.rollback({
  targetVersion: 2,
  operator: "白班主管",
  reason: "夜班价格有误，恢复 v2",
  effectiveDate: "2026-10-01",
  expectedRev: store.currentRev()
});
assert(rbOk.ok, "按最新 rev 回滚成功");
assert(store.latestVersion.version === 4, "回滚生成新版本 v4（不修改历史）");

const v2 = store.versionAt(2)!;
assert(
  FUELS.every((f) => store.latestVersion.snapshot[f] === v2.snapshot[f]),
  "v4 价格完全恢复 v2 审批时的快照"
);
assert(store.latestVersion.source === "rollback", "v4 来源标记为回滚");
assert(store.latestVersion.rollbackFromVersion === 3, "v4 记录回滚自 v3");
assert(store.state.rollbacks.length === 1, "留下一条回滚记录");
assert(store.state.rollbacks[0].toVersion === 2 && store.state.rollbacks[0].fromVersion === 3, "回滚记录路径 v3 → v2");

// 再回滚到 v1 基线，验证回滚目标快照始终取版本自身
store.rollback({
  targetVersion: 1,
  operator: "主管",
  reason: "恢复基线",
  effectiveDate: "2026-10-02",
  expectedRev: store.currentRev()
});
assert(store.latestVersion.version === 5, "再次回滚生成 v5");
assert(
  FUELS.every((f) => store.latestVersion.snapshot[f] === store.versionAt(1)!.snapshot[f]),
  "v5 恢复 v1 基线快照，与之后的 v2~v4 改动无关"
);
assert(store.versionAt(2)!.snapshot["92号汽油"] === 7.72, "历史 v2 快照保持不可变");

console.log(`\n全部 ${passed} 项断言通过`);
