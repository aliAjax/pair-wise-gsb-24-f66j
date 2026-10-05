// 业务规则自检：直接驱动 reducer 与同步引擎，覆盖封存依据链的关键场景。
// 运行：npm run selftest（先由 tsc 把 domain/store 编译到 .selftest/）
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

const { buildSeedState } = require("../.selftest/domain/seed.js");
const { archiveReducer } = require("../.selftest/store/reducer.js");
const { syncOutbox, resyncAll } = require("../.selftest/store/sync.js");
const {
  simulateCompetingWindow,
  loadRemote,
  resetRemote,
} = require("../.selftest/store/remote.js");
const {
  buildSealingBasis,
  sealBlockers,
  coordConflicts,
  pendingSummary,
} = require("../.selftest/domain/rules.js");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}

const run = (s, a) => archiveReducer(s, a);
const sync = (s) => run(s, { type: "applySync", ...syncOutbox(s) });
const L3 = "L-T0203-3";
const l3Ids = (s) =>
  s.artifacts.filter((a) => a.layerId === L3).map((a) => a.id);

// ---------- 1. 坐标必须落进探方网格 ----------
section("1. 出土物坐标校验");
{
  let s = buildSeedState();
  const before = s.artifacts.length;
  s = run(s, { type: "register", unitId: "T0203", layerId: L3, name: "越界陶片", e: 9, n: 1, weightG: 50 });
  check("网格外坐标登记被拒绝", s.artifacts.length === before);
  s = run(s, { type: "register", unitId: "T0203", layerId: L3, name: "界内陶片", e: 5, n: 5, weightG: 50 });
  check("网格内坐标登记成功", s.artifacts.length === before + 1);
}

// ---------- 2. 装袋规则与超上限排队 ----------
section("2. 装袋与排队（不占袋号）");
{
  let s = buildSeedState();
  for (const id of l3Ids(s)) s = run(s, { type: "addToBag", artifactId: id });
  const bag = s.bags.find((b) => b.status === "open");
  const queued = s.artifacts.filter((a) => a.status === "queued");
  check("同探方同地层开一只袋，装满 6 件", bag && bag.itemIds.length === 6);
  check("超上限的 2 件排队", queued.length === 2);
  check("装袋 / 排队阶段未分配袋号", s.bags.every((b) => b.bagNo === null));

  // 运走后不能再装袋
  s = run(s, { type: "transport", artifactId: "A-0009" });
  s = run(s, { type: "addToBag", artifactId: "A-0009" });
  check("已运走出土物不能装袋", !s.bags.some((b) => b.itemIds.includes("A-0009")));
}

// ---------- 3. 封袋分配袋号 + 快照依据 + 换版失效重算 ----------
section("3. 封袋依据与地层换版");
{
  let s = buildSeedState();
  for (const id of l3Ids(s)) s = run(s, { type: "addToBag", artifactId: id });
  const openBag = s.bags.find((b) => b.status === "open");
  s = run(s, { type: "sealBag", bagId: openBag.id });
  const sealed = s.bags.find((b) => b.status === "sealed");
  check("封袋时分配袋号 D-0001", sealed.bagNo === "D-0001");
  check("封袋生成依据快照（地层 v1 · 申请 v1）",
    sealed.basis && sealed.basis.layerVersion === 1 && sealed.basis.appVersion === 1);
  check("排队件自动回填新袋", s.bags.some((b) => b.status === "open" && b.itemIds.length === 2));

  s = run(s, { type: "bumpLayer", layerId: L3 });
  const layer = s.layers.find((l) => l.id === L3);
  const invalidated = s.bags.filter((b) => b.status === "invalidated");
  const repacked = s.bags.find((b) => b.status === "open");
  check("地层换版到 v2", layer.version === 2);
  check("未封袋记录失效", invalidated.length === 1);
  check("失效件按新依据重算（v2）", repacked && repacked.layerVersion === 2 && repacked.itemIds.length === 2);
  check("已封袋保留原依据（仍为 v1）", sealed.basis.layerVersion === 1 &&
    s.bags.find((b) => b.bagNo === "D-0001").basis.layerVersion === 1);
}

// ---------- 4. 封存申请变更触发失效重算 ----------
section("4. 封存申请变更");
{
  let s = buildSeedState();
  for (const id of l3Ids(s).slice(0, 3)) s = run(s, { type: "addToBag", artifactId: id });
  s = run(s, { type: "appSave", unitId: "T0203", note: "变更后的封存申请" });
  const app = s.applications.find((a) => a.unitId === "T0203");
  check("申请版本 v1 → v2 并回到草稿", app.version === 2 && app.status === "draft");
  check("未封袋失效并按申请 v2 重算",
    s.bags.some((b) => b.status === "invalidated") &&
    s.bags.some((b) => b.status === "open" && b.appVersion === 2 && b.itemIds.length === 3));
}

// ---------- 5. 断网本地记录 → 回连合并 → 同袋号先到者生效 ----------
section("5. 断网 / 回连 / 同袋号先到者生效");
{
  resetRemote();
  let s = buildSeedState();
  s = run(s, { type: "setOnline", online: false });
  for (const id of l3Ids(s).slice(0, 6)) s = run(s, { type: "addToBag", artifactId: id });
  s = run(s, { type: "sealBag", bagId: s.bags.find((b) => b.status === "open").id });
  check("断网封袋：本地分配 D-0001 并留在 outbox",
    s.bags[0].bagNo === "D-0001" && s.outbox.length === 1 && s.outbox[0].status === "pending");
  check("断网时远端无记录", Object.keys(loadRemote().bags).length === 0);

  console.log(simulateCompetingWindow("D-0001"));
  s = run(s, { type: "setOnline", online: true });
  s = sync(s);
  const remote = loadRemote();
  const bag = s.bags.find((b) => b.status === "sealed");
  check("先到者生效：D-0001 归外业B组", remote.bags["D-0001"].windowId === "外业B组");
  check("本窗口改发 D-0002", bag.bagNo === "D-0002" && remote.bags["D-0002"] !== undefined);
  check("本地依据快照同步改号", bag.basis.bagNo === "D-0002");
  check("6 件全部入库", Object.keys(remote.items).length === 6 &&
    s.outbox[0].status === "done");

  const before = Object.keys(loadRemote().items).length;
  const msgs = resyncAll(s);
  check("重复回传只入库一次", Object.keys(loadRemote().items).length === before &&
    msgs.some((m) => m.includes("去重 6")));
}

// ---------- 6. 写入失败只重试未完成项 ----------
section("6. 写入失败只重试未完成项");
{
  resetRemote();
  let s = buildSeedState();
  s = run(s, { type: "setOnline", online: false });
  for (const id of l3Ids(s).slice(0, 6)) s = run(s, { type: "addToBag", artifactId: id });
  s = run(s, { type: "sealBag", bagId: s.bags.find((b) => b.status === "open").id });
  s = run(s, { type: "toggleFailure" });
  s = run(s, { type: "setOnline", online: true });

  s = sync(s);
  let done = s.outbox[0].items.filter((i) => i.done).length;
  check("故障中断：仅 1 件入库，其余待重试", done === 1 && Object.keys(loadRemote().items).length === 1);
  s = sync(s);
  done = s.outbox[0].items.filter((i) => i.done).length;
  check("重试只补未完成项（2/6）", done === 2 && Object.keys(loadRemote().items).length === 2);

  s = run(s, { type: "toggleFailure" });
  s = sync(s);
  check("故障恢复后全部入库", s.outbox[0].status === "done" &&
    Object.keys(loadRemote().items).length === 6);
}

// ---------- 7. 封存申请通过门槛 ----------
section("7. 封存申请通过门槛");
{
  resetRemote();
  let s = buildSeedState();
  for (const id of l3Ids(s)) s = run(s, { type: "addToBag", artifactId: id });
  s = run(s, { type: "appSubmit", unitId: "T0203" });
  s = run(s, { type: "appApprove", unitId: "T0203" });
  check("有待封袋时审批不通过", s.units.find((u) => u.id === "T0203").status === "open" &&
    sealBlockers(s, "T0203").length > 0);

  s = run(s, { type: "sealBag", bagId: s.bags.find((b) => b.status === "open").id });
  s = run(s, { type: "sealBag", bagId: s.bags.find((b) => b.status === "open").id });
  check("全部封袋后无待处理项", pendingSummary(s, "T0203").openBags.length === 0 &&
    pendingSummary(s, "T0203").queued.length === 0);
  s = run(s, { type: "appApprove", unitId: "T0203" });
  check("审批通过，探方封存", s.units.find((u) => u.id === "T0203").status === "sealed" &&
    s.applications.find((a) => a.unitId === "T0203").status === "approved");
}

// ---------- 8. 坐标冲突阻断审批，修正后放行 ----------
section("8. 坐标冲突阻断与修正");
{
  let s = buildSeedState();
  s = run(s, { type: "resizeGrid", unitId: "T0203", gridE: 2, gridN: 2 });
  const conflicts = coordConflicts(s, "T0203");
  check("网格收缩产生坐标冲突", conflicts.length > 0);
  s = run(s, { type: "appSubmit", unitId: "T0203" });
  s = run(s, { type: "appApprove", unitId: "T0203" });
  check("有坐标冲突时审批不通过", s.units.find((u) => u.id === "T0203").status === "open");
  for (const a of [...conflicts]) s = run(s, { type: "fixCoord", artifactId: a.id, e: 1, n: 1 });
  check("逐件修正后冲突清零", coordConflicts(s, "T0203").length === 0 &&
    sealBlockers(s, "T0203").length === 0);
  s = run(s, { type: "appApprove", unitId: "T0203" });
  check("审批通过", s.units.find((u) => u.id === "T0203").status === "sealed");
}

// ---------- 9. 页面与导出同一依据 ----------
section("9. 页面与导出同一依据");
{
  let s = buildSeedState();
  for (const id of l3Ids(s).slice(0, 6)) s = run(s, { type: "addToBag", artifactId: id });
  s = run(s, { type: "sealBag", bagId: s.bags.find((b) => b.status === "open").id });
  const b1 = buildSealingBasis(s, "T0203");
  const b2 = buildSealingBasis(s, "T0203");
  check("同一状态摘要一致", b1.digest === b2.digest);
  s = run(s, { type: "bumpLayer", layerId: L3 });
  const b3 = buildSealingBasis(s, "T0203");
  check("换版后依据摘要变化", b3.digest !== b1.digest);
  check("依据中已封袋仍引用原版本 v1",
    b3.sealedBags.length === 1 && b3.sealedBags[0].layerVersion === 1);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
