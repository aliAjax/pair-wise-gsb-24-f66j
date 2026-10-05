import { BAG_MAX_ITEMS, BAG_MAX_WEIGHT_G } from "../domain/constants";
import {
  bagEligibility,
  bagFits,
  coordConflicts,
  currentAppVersion,
  getLayer,
  getUnit,
  isCoordInside,
  openBagOf,
  sealBlockers,
} from "../domain/rules";
import { buildSeedState } from "../domain/seed";
import type { ArchiveState, Artifact, SampleBag, SyncOp } from "../domain/types";
import { formatBagNo, WINDOW_ID } from "./remote";

export type ArchiveAction =
  | { type: "register"; unitId: string; layerId: string; name: string; e: number; n: number; weightG: number }
  | { type: "addToBag"; artifactId: string }
  | { type: "sealBag"; bagId: string }
  | { type: "bumpLayer"; layerId: string }
  | { type: "resizeGrid"; unitId: string; gridE: number; gridN: number }
  | { type: "fixCoord"; artifactId: string; e: number; n: number }
  | { type: "transport"; artifactId: string }
  | { type: "appSave"; unitId: string; note: string }
  | { type: "appSubmit"; unitId: string }
  | { type: "appApprove"; unitId: string }
  | { type: "setOnline"; online: boolean }
  | { type: "toggleFailure" }
  | { type: "applySync"; outbox: SyncOp[]; bags: SampleBag[]; minNextBagSeq: number; messages: string[] }
  | { type: "log"; messages: string[] }
  | { type: "reset" };

const pad = (n: number) => String(n).padStart(4, "0");

function logInto(s: ArchiveState, messages: string | string[]): void {
  const list = Array.isArray(messages) ? messages : [messages];
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  s.log = [...list.map((m) => `${stamp} ${m}`), ...s.log].slice(0, 40);
}

/** 深拷贝一份可变的草稿，转移函数在草稿上修改 */
function draft(state: ArchiveState): ArchiveState {
  return {
    ...state,
    units: state.units.map((u) => ({ ...u })),
    layers: state.layers.map((l) => ({ ...l })),
    artifacts: state.artifacts.map((a) => ({ ...a })),
    bags: state.bags.map((b) => ({
      ...b,
      itemIds: [...b.itemIds],
      basis: b.basis ? { ...b.basis, itemIds: [...b.basis.itemIds] } : null,
    })),
    applications: state.applications.map((a) => ({ ...a })),
    outbox: state.outbox.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i })) })),
    seq: { ...state.seq },
    log: [...state.log],
  };
}

/**
 * 装袋：只能装同探方同地层、已登记且未运走的出土物；
 * 超过件数 / 总重上限就排队，排队与装袋阶段都不占袋号。
 */
function packOneMutable(s: ArchiveState, artifactId: string): void {
  const artifact = s.artifacts.find((a) => a.id === artifactId);
  if (!artifact) return;
  const eligibility = bagEligibility(s, artifact);
  if (!eligibility.ok) {
    logInto(s, `${artifact.id} ${artifact.name} 不可装袋：${eligibility.reason}`);
    return;
  }
  const layer = getLayer(s, artifact.layerId);
  let bag = openBagOf(s, artifact.unitId, artifact.layerId);
  if (!bag) {
    bag = {
      id: `G-${pad(s.seq.bagInternal)}`,
      unitId: artifact.unitId,
      layerId: artifact.layerId,
      layerVersion: layer.version,
      appVersion: currentAppVersion(s, artifact.unitId),
      bagNo: null, // 袋号封袋时才分配
      itemIds: [],
      totalWeightG: 0,
      status: "open",
      sealedAt: null,
      basis: null,
    };
    s.seq.bagInternal += 1;
    s.bags.push(bag);
  }
  if (bagFits(bag, artifact)) {
    bag.itemIds.push(artifact.id);
    bag.totalWeightG += artifact.weightG;
    artifact.status = "bagged";
    artifact.bagId = bag.id;
    artifact.layerVersion = layer.version;
  } else {
    artifact.status = "queued";
    logInto(
      s,
      `${artifact.id} 超上限（≤${BAG_MAX_ITEMS} 件 且 ≤${BAG_MAX_WEIGHT_G}g），排队待装，不占袋号`
    );
  }
}

/** 封袋后把该地层的排队件回填进新袋 */
function repackQueueMutable(s: ArchiveState, unitId: string, layerId: string): void {
  const queued = s.artifacts.filter(
    (a) => a.unitId === unitId && a.layerId === layerId && a.status === "queued"
  );
  for (const a of queued) packOneMutable(s, a.id);
}

/**
 * 地层换版 / 封存申请变更：范围内未封袋记录失效，
 * 袋内与排队件回到已登记后按新依据重算；已封袋保留原依据不动。
 */
function invalidateAndRepackMutable(
  s: ArchiveState,
  unitId: string,
  layerId: string | null,
  cause: string
): void {
  const inScope = (u: string, l: string) => u === unitId && (layerId === null || l === layerId);
  const openBags = s.bags.filter((b) => b.status === "open" && inScope(b.unitId, b.layerId));
  const affected: string[] = [];
  for (const bag of openBags) {
    for (const id of bag.itemIds) if (!affected.includes(id)) affected.push(id);
    bag.status = "invalidated";
  }
  for (const a of s.artifacts) {
    if (a.status === "queued" && inScope(a.unitId, a.layerId) && !affected.includes(a.id)) {
      affected.push(a.id);
    }
  }
  if (openBags.length === 0 && affected.length === 0) return;
  for (const id of affected) {
    const a = s.artifacts.find((x) => x.id === id);
    if (!a) continue;
    a.status = "registered";
    a.bagId = null;
    a.layerVersion = getLayer(s, a.layerId).version;
  }
  logInto(
    s,
    `${cause}：${openBags.length} 只未封袋失效，${affected.length} 件按新依据重算（已封袋保留原依据）`
  );
  for (const id of affected) packOneMutable(s, id);
}

/** 封袋：此刻才分配袋号，并生成回传任务（断网则留在本地 outbox） */
function sealBagMutable(s: ArchiveState, bagId: string): void {
  const bag = s.bags.find((b) => b.id === bagId);
  if (!bag || bag.status !== "open") {
    logInto(s, "只能封存待封袋");
    return;
  }
  if (bag.itemIds.length === 0) {
    logInto(s, "空袋不能封存");
    return;
  }
  const bagNo = formatBagNo(s.seq.bag);
  s.seq.bag += 1;
  bag.status = "sealed";
  bag.bagNo = bagNo;
  bag.sealedAt = Date.now();
  bag.basis = {
    bagNo,
    unitId: bag.unitId,
    layerId: bag.layerId,
    layerVersion: bag.layerVersion,
    appVersion: bag.appVersion,
    itemIds: [...bag.itemIds],
    itemCount: bag.itemIds.length,
    totalWeightG: bag.totalWeightG,
    sealedAt: bag.sealedAt,
  };
  for (const id of bag.itemIds) {
    const a = s.artifacts.find((x) => x.id === id);
    if (a) a.status = "sealed";
  }
  s.outbox.push({
    opId: `OP-${pad(s.seq.op)}`,
    kind: "sealBag",
    windowId: WINDOW_ID,
    bagId: bag.id,
    bagNo,
    items: bag.itemIds.map((id) => ({ artifactId: id, key: `${bagNo}::${id}`, done: false })),
    status: "pending",
    attempts: 0,
  });
  s.seq.op += 1;
  logInto(
    s,
    `封袋 ${bagNo}：${bag.basis.itemCount} 件 / ${bag.totalWeightG}g，依据 地层v${bag.layerVersion}·申请v${bag.appVersion}` +
      (s.online ? "" : "（断网，本地待回连）")
  );
  repackQueueMutable(s, bag.unitId, bag.layerId);
}

export function archiveReducer(prev: ArchiveState, action: ArchiveAction): ArchiveState {
  switch (action.type) {
    case "reset":
      return buildSeedState();

    case "log": {
      const s = draft(prev);
      logInto(s, action.messages);
      return s;
    }

    case "toggleFailure": {
      const s = draft(prev);
      s.simulateFailure = !s.simulateFailure;
      logInto(s, s.simulateFailure ? "已开启写入故障模拟：同步将部分失败" : "已关闭写入故障模拟");
      return s;
    }

    case "setOnline": {
      const s = draft(prev);
      s.online = action.online;
      logInto(
        s,
        action.online ? "网络回连：开始按袋号逐件合并" : "已断网：记录仅保存在本地"
      );
      return s;
    }

    case "applySync": {
      const s = draft(prev);
      s.outbox = action.outbox;
      s.bags = action.bags;
      s.seq.bag = Math.max(s.seq.bag, action.minNextBagSeq);
      logInto(s, action.messages);
      return s;
    }

    case "register": {
      const s = draft(prev);
      const unit = getUnit(s, action.unitId);
      if (unit.status === "sealed") {
        logInto(s, "探方已封存，禁止新登记");
        return s;
      }
      if (!action.name.trim()) {
        logInto(s, "登记失败：名称不能为空");
        return s;
      }
      if (!(action.weightG > 0)) {
        logInto(s, "登记失败：重量必须大于 0");
        return s;
      }
      if (!isCoordInside(unit, action.e, action.n)) {
        logInto(
          s,
          `登记失败：坐标 E${action.e}N${action.n} 超出 ${unit.id} 网格（E1–${unit.gridE} / N1–${unit.gridN}）`
        );
        return s;
      }
      const layer = s.layers.find((l) => l.id === action.layerId && l.unitId === unit.id);
      if (!layer) {
        logInto(s, "登记失败：地层不属于该探方");
        return s;
      }
      const artifact: Artifact = {
        id: `A-${pad(s.seq.artifact)}`,
        unitId: unit.id,
        layerId: layer.id,
        layerVersion: layer.version,
        name: action.name.trim(),
        coordE: action.e,
        coordN: action.n,
        weightG: action.weightG,
        status: "registered",
        bagId: null,
      };
      s.seq.artifact += 1;
      s.artifacts.push(artifact);
      logInto(s, `登记 ${artifact.id} ${artifact.name} @ E${action.e}N${action.n}（${layer.name} v${layer.version}）`);
      return s;
    }

    case "addToBag": {
      const s = draft(prev);
      packOneMutable(s, action.artifactId);
      return s;
    }

    case "sealBag": {
      const s = draft(prev);
      sealBagMutable(s, action.bagId);
      return s;
    }

    case "bumpLayer": {
      const s = draft(prev);
      const layer = getLayer(s, action.layerId);
      const unit = getUnit(s, layer.unitId);
      if (unit.status === "sealed") {
        logInto(s, "探方已封存，地层不可换版");
        return s;
      }
      layer.version += 1;
      logInto(s, `${unit.id} ${layer.name} 换版 → v${layer.version}`);
      invalidateAndRepackMutable(s, unit.id, layer.id, "地层换版");
      return s;
    }

    case "resizeGrid": {
      const s = draft(prev);
      const unit = getUnit(s, action.unitId);
      if (unit.status === "sealed") {
        logInto(s, "探方已封存，网格不可调整");
        return s;
      }
      const ok =
        Number.isInteger(action.gridE) &&
        Number.isInteger(action.gridN) &&
        action.gridE >= 1 &&
        action.gridN >= 1 &&
        action.gridE <= 12 &&
        action.gridN <= 12;
      if (!ok) {
        logInto(s, "网格尺寸需为 1–12 的整数");
        return s;
      }
      unit.gridE = action.gridE;
      unit.gridN = action.gridN;
      const conflicts = coordConflicts(s, unit.id);
      logInto(
        s,
        `网格调整为 E1–${unit.gridE} / N1–${unit.gridN}` +
          (conflicts.length ? `，产生 ${conflicts.length} 处坐标冲突` : "，无坐标冲突")
      );
      return s;
    }

    case "fixCoord": {
      const s = draft(prev);
      const a = s.artifacts.find((x) => x.id === action.artifactId);
      if (!a) return s;
      if (a.status === "sealed" || a.status === "transported") {
        logInto(s, `${a.id} 已封袋 / 已运走，坐标不可改`);
        return s;
      }
      const unit = getUnit(s, a.unitId);
      if (!isCoordInside(unit, action.e, action.n)) {
        logInto(s, `坐标 E${action.e}N${action.n} 仍在网格外`);
        return s;
      }
      a.coordE = action.e;
      a.coordN = action.n;
      logInto(s, `${a.id} 坐标修正为 E${action.e}N${action.n}`);
      return s;
    }

    case "transport": {
      const s = draft(prev);
      const a = s.artifacts.find((x) => x.id === action.artifactId);
      if (!a) return s;
      if (a.status !== "registered" && a.status !== "queued") {
        logInto(s, `${a.id} 已入袋，不能标记运走`);
        return s;
      }
      a.status = "transported";
      a.bagId = null;
      logInto(s, `${a.id} ${a.name} 已运走，不再参与装袋`);
      return s;
    }

    case "appSave": {
      const s = draft(prev);
      const unit = getUnit(s, action.unitId);
      if (unit.status === "sealed") {
        logInto(s, "探方已封存，申请不可变更");
        return s;
      }
      const app = s.applications.find((a) => a.unitId === action.unitId);
      if (app) {
        app.version += 1;
        app.status = "draft";
        app.note = action.note;
        app.updatedAt = Date.now();
        logInto(s, `封存申请变更 → v${app.version}`);
      } else {
        s.applications.push({
          id: `S-${action.unitId}`,
          unitId: action.unitId,
          version: 1,
          status: "draft",
          note: action.note,
          updatedAt: Date.now(),
        });
        logInto(s, "新建封存申请 v1");
      }
      invalidateAndRepackMutable(s, action.unitId, null, "封存申请变更");
      return s;
    }

    case "appSubmit": {
      const s = draft(prev);
      const app = s.applications.find((a) => a.unitId === action.unitId);
      if (!app) {
        logInto(s, "请先填写封存申请");
        return s;
      }
      if (app.status !== "draft") {
        logInto(s, "仅草稿可提交");
        return s;
      }
      app.status = "submitted";
      app.updatedAt = Date.now();
      logInto(s, `封存申请 v${app.version} 已提交，待审批`);
      return s;
    }

    case "appApprove": {
      const s = draft(prev);
      const app = s.applications.find((a) => a.unitId === action.unitId);
      const unit = getUnit(s, action.unitId);
      if (!app || app.status !== "submitted") {
        logInto(s, "申请未提交，不能审批");
        return s;
      }
      const blockers = sealBlockers(s, action.unitId);
      if (blockers.length > 0) {
        logInto(s, ["审批未通过：", ...blockers.map((b) => `· ${b}`)]);
        return s;
      }
      app.status = "approved";
      app.updatedAt = Date.now();
      unit.status = "sealed";
      logInto(s, `封存申请 v${app.version} 通过，${unit.id} 封存（依据摘要见导出）`);
      return s;
    }
  }
}
