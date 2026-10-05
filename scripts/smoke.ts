// 冒烟测试：验证封存依据核心业务规则（node 环境，无 DOM）
// 运行：npm run smoke

// --- 浏览器环境桩 ---
const stores = new Map<string, string>();
function makeStorage() {
  return {
    getItem: (k: string) => stores.get(k) ?? null,
    setItem: (k: string, v: string) => void stores.set(k, String(v)),
    removeItem: (k: string) => void stores.delete(k),
    clear: () => stores.clear(),
  };
}
(globalThis as any).localStorage = makeStorage();
(globalThis as any).sessionStorage = makeStorage();
(globalThis as any).navigator = { locks: undefined };

const { reducer } = await import("../src/store");
const { seedState } = await import("../src/seed");
const rules = await import("../src/rules");
const remote = await import("../src/remote");
const { BAG_MAX_ITEMS, BAG_MAX_WEIGHT } = await import("../src/types");

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}`, extra ?? "");
  }
}

// ---------- 1. 坐标落格校验 ----------
console.log("1. 坐标落格校验");
let s = seedState("winA");
const unit4 = s.units.find((u) => u.id === "T0204")!;
s = reducer(s, {
  type: "register-artifact",
  input: { unitId: "T0204", layerId: "L-T0204-H12", name: "测试骨片X", weight: 100, e: 9.9, n: 1 },
});
const ax = s.artifacts[s.artifacts.length - 1];
check("出格坐标登记后标记为冲突", rules.coordConflict(ax, unit4));
check("冲突计入本探方封存阻碍", rules.sealBlockers(s, "T0204").conflicts.length === 1);
check("冲突不影响其他探方", rules.sealBlockers(s, "T0203").conflicts.length === 0);
check("种子数据 T0301 自带 1 件冲突（夯土块）", rules.sealBlockers(s, "T0301").conflicts.length === 1);
s = reducer(s, { type: "fix-coord", id: ax.id, e: 2.0, n: 2.0 });
check("修正坐标后冲突解除", rules.sealBlockers(s, "T0204").conflicts.length === 0);

// ---------- 2. 超限排队不占袋号，结算时才发号 ----------
console.log("2. 超限排队不占袋号");
const layerT3 = "L-T0203-3";
const allIds = s.artifacts
  .filter((a) => a.unitId === "T0203" && a.layerId === layerT3 && a.status === "registered")
  .map((a) => a.id);
check("种子 14 件陶片可全选", allIds.length === 14, allIds.length);
s = reducer(s, { type: "request-bag", unitId: "T0203", layerId: layerT3, itemIds: allIds });
check("超限请求进入排队", s.queue.filter((q) => q.status === "queued").length === 1);
check("排队未发袋号", s.bags.length === 0 && Object.keys(s.bagSeq).length === 0);
const req = s.queue.find((q) => q.status === "queued")!;
s = reducer(s, { type: "settle-request", requestId: req.id });
check("结算后按上限分袋发号", s.bags.length === 2, s.bags.map((b) => [b.bagNo, b.items.length, b.totalWeight]));
check(
  "袋号按序分配 T0203-③-001/002",
  s.bags.some((b) => b.bagNo === "T0203-③-001") && s.bags.some((b) => b.bagNo === "T0203-③-002")
);
check(
  "每袋件数与总重均不超限",
  s.bags.every((b) => b.items.length <= BAG_MAX_ITEMS && b.totalWeight <= BAG_MAX_WEIGHT)
);
check("排队单已结案", s.queue.every((q) => q.status !== "queued"));
check(
  "出土物状态联动为已装袋",
  s.artifacts.filter((a) => a.unitId === "T0203" && a.status === "bagged").length === 14
);

// ---------- 3. 已运走出土物不能入袋 ----------
console.log("3. 运走限制");
const shipped = s.artifacts.find((a) => a.status === "shipped")!;
const bagsBefore = s.bags.length;
s = reducer(s, {
  type: "request-bag",
  unitId: shipped.unitId,
  layerId: shipped.layerId,
  itemIds: [shipped.id],
});
check("已运走出土物不能装袋", s.bags.length === bagsBefore);

// ---------- 4. 封袋固化依据，换版后未封袋失效重算、已封袋保留原依据 ----------
console.log("4. 换版失效重算");
const bag1 = s.bags.find((b) => b.bagNo === "T0203-③-001")!;
const bag2 = s.bags.find((b) => b.bagNo === "T0203-③-002")!;
s = reducer(s, { type: "seal-bag", bagId: bag1.id });
check("袋1封袋成功", s.bags.find((b) => b.id === bag1.id)!.status === "sealed");
s = reducer(s, { type: "bump-layer", layerId: layerT3 });
const b1 = s.bags.find((b) => b.id === bag1.id)!;
const b2 = s.bags.find((b) => b.id === bag2.id)!;
check("换版后已封袋保留原依据 v1", b1.status === "sealed" && b1.basis.layerVersion === 1);
check("换版后未封袋作废", b2.status === "void");
check("失效出土物回到已登记并生成重算单", s.queue.some((q) => q.status === "queued" && q.reason === "失效重算"));
s = reducer(s, { type: "settle-request", requestId: s.queue.find((q) => q.status === "queued")!.id });
const bag3 = s.bags.find((b) => b.status === "open")!;
check("重算装袋使用新依据 v2", bag3.basis.layerVersion === 2, bag3.basis);
check("重算新袋继续发号不复用", bag3.bagNo === "T0203-③-003", bag3.bagNo);

// ---------- 5. 封存申请建立与变更同样触发失效重算 ----------
console.log("5. 申请变更失效重算");
s = reducer(s, { type: "create-application", unitId: "T0203", note: "第3层整理完毕，申请封存" });
check("申请建立后未封袋失效", s.bags.find((b) => b.id === bag3.id)!.status === "void");
s = reducer(s, { type: "settle-request", requestId: s.queue.find((q) => q.status === "queued")!.id });
const bag4 = s.bags.find((b) => b.status === "open")!;
check("重算袋依据含申请版次 r1", bag4.basis.appRevision === 1, bag4.basis);
s = reducer(s, { type: "change-application", unitId: "T0203", note: "补充：含后续小件，重新申请" });
check("申请变更后未封袋再次失效", s.bags.find((b) => b.id === bag4.id)!.status === "void");
s = reducer(s, { type: "settle-request", requestId: s.queue.find((q) => q.status === "queued")!.id });
const bag5 = s.bags.find((b) => b.status === "open")!;
check("重算袋依据更新为 r2", bag5.basis.appRevision === 2, bag5.basis);

// ---------- 6. 封存申请通过条件 ----------
console.log("6. 封存申请审批");
s = reducer(s, { type: "approve-application", unitId: "T0203" });
check("有未封袋时不能通过", s.applications.find((a) => a.unitId === "T0203")!.status !== "approved");
s = reducer(s, { type: "seal-bag", bagId: bag5.id });
const blk = rules.sealBlockers(s, "T0203");
check("封袋后阻碍清零", rules.canApprove(blk), blk);
s = reducer(s, { type: "approve-application", unitId: "T0203" });
check("阻碍清零后申请通过", s.applications.find((a) => a.unitId === "T0203")!.status === "approved");
check("探方状态联动为已封存", s.units.find((u) => u.id === "T0203")!.status === "sealed");
const before = s.artifacts.length;
s = reducer(s, {
  type: "register-artifact",
  input: { unitId: "T0203", layerId: layerT3, name: "封存后登记", weight: 1, e: 1, n: 1 },
});
check("封存后不能再登记", s.artifacts.length === before);

// ---------- 7. 离线回传：逐件合并、幂等、先到者生效、失败重试 ----------
console.log("7. 离线回传");
remote.resetRemote();
// 窗口A 离线装两袋并封第二袋
let a = seedState("winA");
a = { ...a, online: false };
a = reducer(a, { type: "request-bag", unitId: "T0203", layerId: layerT3, itemIds: allIds.slice(0, 5) });
a = reducer(a, { type: "request-bag", unitId: "T0203", layerId: layerT3, itemIds: allIds.slice(5, 9) });
a = reducer(a, { type: "seal-bag", bagId: a.bags[0].id }); // bags 前插，[0] 为 002
check("离线操作全部进入本地队列", a.outbox.length === 3 && a.outbox.every((o) => o.status === "pending"));

// 窗口B 同时离线装袋（同袋号冲突场景）
let b = seedState("winB");
b = { ...b, online: false };
b = reducer(b, { type: "request-bag", unitId: "T0203", layerId: layerT3, itemIds: allIds.slice(0, 3) });
check("两窗口各自发到同一袋号", b.bags[0].bagNo === a.bags[1].bagNo, [b.bags[0].bagNo, a.bags[1].bagNo]);

// B 先回连 → 先到者生效
for (const op of b.outbox) {
  const r = await remote.commitOp(op, "winB", false);
  check("B 窗口提交入库", !r.conflict, r);
}
// A 回连：001 与 B 撞号 → 作废；002 与封袋正常
for (const op of a.outbox) {
  const r = await remote.commitOp(op, "winA", false);
  if (r.conflict) a = reducer(a, { type: "bag-conflict", bagNo: String(op.payload.bagNo), note: r.note });
  a = reducer(a, { type: "op-done", id: op.id, note: r.note });
}
check("A 撞号袋被判定冲突作废", a.bags.find((x) => x.bagNo === "T0203-③-001")!.status === "void");
check("A 未撞号的袋正常入库封口", remote.loadRemote().bags["T0203-③-002"]?.status === "sealed");
check("冲突袋出土物释放重算", a.queue.some((q) => q.status === "queued" && q.reason === "失效重算"));

// 重复回传只入库一次
const dup = await remote.commitOp(b.outbox[0], "winB", false);
check("重复回传被跳过", dup.skipped === true, dup);
check("远端袋件数未因重复回传翻倍", remote.loadRemote().bags["T0203-③-001"].items.length === 3);

// 同一袋号逐件合并：同一袋（同 localId）补传
const mergeOp = {
  ...b.outbox[0],
  id: "op-merge-2",
  payload: {
    ...(b.outbox[0].payload as any),
    items: [(b.outbox[0].payload as any).items[0], { id: "A-extra", name: "补登陶片", weight: 50 }],
  },
};
const merged = await remote.commitOp(mergeOp as any, "winB", false);
const bagAfter = remote.loadRemote().bags["T0203-③-001"];
check("逐件合并只补新件", bagAfter.items.length === 4 && !merged.conflict, merged.note);

// 写入失败只重试未完成项
remote.resetRemote();
let c = seedState("winC");
c = reducer(c, { type: "request-bag", unitId: "T0203", layerId: layerT3, itemIds: allIds.slice(0, 4) });
c = reducer(c, { type: "seal-bag", bagId: c.bags[0].id });
for (const op of c.outbox) {
  try {
    const r = await remote.commitOp(op, "winC", true); // 封口接口故障
    c = reducer(c, { type: "op-done", id: op.id, note: r.note });
  } catch (e) {
    c = reducer(c, { type: "op-failed", id: op.id, error: (e as Error).message });
    break;
  }
}
check(
  "故障时装袋已入库、封袋失败待重试",
  c.outbox[0].status === "done" && c.outbox[1].status === "failed",
  c.outbox.map((o) => [o.kind, o.status])
);
for (const op of c.outbox.filter((o) => o.status !== "done")) {
  const r = await remote.commitOp(op, "winC", false);
  c = reducer(c, { type: "op-done", id: op.id, note: r.note });
}
check("重试后全部入库", c.outbox.every((o) => o.status === "done"));
check("远端袋状态为已封", remote.loadRemote().bags["T0203-③-001"].status === "sealed");

// ---------- 8. 页面与导出同一依据 ----------
console.log("8. 页面与导出同源");
const report = rules.buildBasisReport(s, "T0203");
check(
  "报告含已封袋原依据快照",
  report.bags.some((x: any) => x.basisText.includes("地层v1") && x.status === "sealed")
);
check("报告结论与页面选择器一致", report.canApprove === rules.canApprove(rules.sealBlockers(s, "T0203")));

console.log(failures ? `\n共 ${failures} 项失败` : "\n全部通过");
process.exit(failures ? 1 : 0);
