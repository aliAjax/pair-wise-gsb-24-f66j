import {
  AppState,
  Artifact,
  BAG_MAX_ITEMS,
  BAG_MAX_WEIGHT,
  BagBasis,
  GridUnit,
} from "./types";

export function findUnit(state: AppState, unitId: string): GridUnit {
  const u = state.units.find((x) => x.id === unitId);
  if (!u) throw new Error(`探方不存在：${unitId}`);
  return u;
}

/** 坐标必须落在所属探方网格内 */
export function coordConflict(a: Pick<Artifact, "e" | "n">, u: GridUnit): boolean {
  return a.e < 0 || a.e > u.east || a.n < 0 || a.n > u.north;
}

/** 当前依据：地层现行版本 + 封存申请现行版次（无申请记 r0） */
export function currentBasis(state: AppState, unitId: string, layerId: string): BagBasis {
  const layer = state.layers.find((l) => l.id === layerId);
  const app = state.applications.find((a) => a.unitId === unitId);
  return { layerVersion: layer?.version ?? 0, appRevision: app?.revision ?? 0 };
}

export function basisEq(a: BagBasis, b: BagBasis): boolean {
  return a.layerVersion === b.layerVersion && a.appRevision === b.appRevision;
}

export function basisText(b: BagBasis): string {
  return `地层v${b.layerVersion} · 申请r${b.appRevision}`;
}

export function scopeKey(unitId: string, layerId: string): string {
  return `${unitId}|${layerId}`;
}

export function makeBagNo(unitId: string, layerCode: string, seq: number): string {
  return `${unitId}-${layerCode}-${String(seq).padStart(3, "0")}`;
}

export interface LimitCheck {
  count: number;
  weight: number;
  ok: boolean;
}

export function checkBagLimits(items: { weight: number }[]): LimitCheck {
  const count = items.length;
  const weight = items.reduce((s, i) => s + i.weight, 0);
  return { count, weight, ok: count > 0 && count <= BAG_MAX_ITEMS && weight <= BAG_MAX_WEIGHT };
}

/** 超限部分排队：按登记顺序贪心装袋，单件超重的留下继续排队 */
export function packIntoBags<T extends { weight: number }>(items: T[]): { groups: T[][]; rest: T[] } {
  const groups: T[][] = [];
  const rest: T[] = [];
  let cur: T[] = [];
  let w = 0;
  for (const it of items) {
    if (it.weight > BAG_MAX_WEIGHT) {
      rest.push(it);
      continue;
    }
    if (cur.length >= BAG_MAX_ITEMS || w + it.weight > BAG_MAX_WEIGHT) {
      groups.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(it);
    w += it.weight;
  }
  if (cur.length) groups.push(cur);
  return { groups, rest };
}

/** 排队中的出土物 id 集合（防止重复占用） */
export function queuedItemIds(state: AppState): Set<string> {
  const s = new Set<string>();
  for (const q of state.queue) {
    if (q.status === "queued") q.itemIds.forEach((id) => s.add(id));
  }
  return s;
}

export interface SealBlockers {
  openBags: { bagNo: string }[];
  queuedRequests: { id: string }[];
  conflicts: Artifact[];
}

/** 封存申请通过条件：没有待处理袋（未封袋 + 排队单）且没有坐标冲突 */
export function sealBlockers(state: AppState, unitId: string): SealBlockers {
  const unit = findUnit(state, unitId);
  const openBags = state.bags
    .filter((b) => b.unitId === unitId && b.status === "open")
    .map((b) => ({ bagNo: b.bagNo }));
  const queuedRequests = state.queue
    .filter((q) => q.unitId === unitId && q.status === "queued")
    .map((q) => ({ id: q.id }));
  const conflicts = state.artifacts.filter(
    (a) => a.unitId === unitId && a.status !== "shipped" && a.status !== "sealed" && coordConflict(a, unit)
  );
  return { openBags, queuedRequests, conflicts };
}

export function canApprove(b: SealBlockers): boolean {
  return b.openBags.length === 0 && b.queuedRequests.length === 0 && b.conflicts.length === 0;
}

/** 封存依据报告：页面展示与导出共用同一选择器，保证同源 */
export function buildBasisReport(state: AppState, unitId: string) {
  const unit = findUnit(state, unitId);
  const app = state.applications.find((a) => a.unitId === unitId) ?? null;
  const layers = state.layers.filter((l) => l.unitId === unitId);
  const artifacts = state.artifacts
    .filter((a) => a.unitId === unitId)
    .map((a) => ({ ...a, coordOk: !coordConflict(a, unit) }));
  const bags = state.bags
    .filter((b) => b.unitId === unitId)
    .map((b) => ({
      bagNo: b.bagNo,
      status: b.status,
      basis: b.basis,
      basisText: basisText(b.basis),
      itemCount: b.items.length,
      totalWeight: b.totalWeight,
      items: b.items,
      voidReason: b.voidReason,
      createdAt: new Date(b.createdAt).toISOString(),
      sealedAt: b.sealedAt ? new Date(b.sealedAt).toISOString() : null,
    }));
  const blockers = sealBlockers(state, unitId);
  return {
    title: `封存依据 · ${unitId}`,
    generatedAt: new Date().toISOString(),
    unit,
    application: app,
    layers,
    artifacts,
    bags,
    pending: {
      openBags: blockers.openBags.length,
      queuedRequests: blockers.queuedRequests.length,
      coordConflicts: blockers.conflicts.length,
    },
    sync: {
      pendingOps: state.outbox.filter((o) => o.status !== "done").length,
      doneOps: state.outbox.filter((o) => o.status === "done").length,
    },
    canApprove: canApprove(blockers),
  };
}

export function fmtWeight(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(2)}kg` : `${g}g`;
}

export function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
