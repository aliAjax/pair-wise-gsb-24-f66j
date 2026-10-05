import { BAG_MAX_ITEMS, BAG_MAX_WEIGHT_G } from "./constants";
import type {
  ArchiveState,
  Artifact,
  ExcavationUnit,
  Layer,
  SampleBag,
  SealingBasis,
} from "./types";

export function getUnit(state: ArchiveState, unitId: string): ExcavationUnit {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) throw new Error(`未知探方 ${unitId}`);
  return unit;
}

export function getLayer(state: ArchiveState, layerId: string): Layer {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`未知地层 ${layerId}`);
  return layer;
}

export function layerName(state: ArchiveState, layerId: string): string {
  return state.layers.find((l) => l.id === layerId)?.name ?? layerId;
}

/** 坐标是否落进探方网格（E/N 均为 1 起始的整数格） */
export function isCoordInside(unit: ExcavationUnit, e: number, n: number): boolean {
  return (
    Number.isInteger(e) &&
    Number.isInteger(n) &&
    e >= 1 &&
    e <= unit.gridE &&
    n >= 1 &&
    n <= unit.gridN
  );
}

/** 坐标冲突：未封袋、未运走的出土物，坐标落在探方网格外 */
export function coordConflicts(state: ArchiveState, unitId: string): Artifact[] {
  const unit = getUnit(state, unitId);
  return state.artifacts.filter(
    (a) =>
      a.unitId === unitId &&
      a.status !== "transported" &&
      a.status !== "sealed" &&
      !isCoordInside(unit, a.coordE, a.coordN)
  );
}

/** 当前封存申请版本（无申请记 0） */
export function currentAppVersion(state: ArchiveState, unitId: string): number {
  return state.applications.find((a) => a.unitId === unitId)?.version ?? 0;
}

/** 同一探方同一地层至多一只待封袋 */
export function openBagOf(
  state: ArchiveState,
  unitId: string,
  layerId: string
): SampleBag | undefined {
  return state.bags.find(
    (b) => b.unitId === unitId && b.layerId === layerId && b.status === "open"
  );
}

/** 袋内件数与总重上限：超过即排队 */
export function bagFits(bag: SampleBag, artifact: Artifact): boolean {
  return (
    bag.itemIds.length + 1 <= BAG_MAX_ITEMS &&
    bag.totalWeightG + artifact.weightG <= BAG_MAX_WEIGHT_G
  );
}

/** 装袋资格：同探方同地层、已登记（或排队回填）、未运走、坐标在网格内 */
export function bagEligibility(
  state: ArchiveState,
  artifact: Artifact
): { ok: boolean; reason: string | null } {
  const unit = getUnit(state, artifact.unitId);
  if (unit.status === "sealed") return { ok: false, reason: "探方已封存" };
  if (artifact.status === "transported") return { ok: false, reason: "已运走" };
  if (artifact.status !== "registered" && artifact.status !== "queued")
    return { ok: false, reason: "已入袋" };
  if (!isCoordInside(unit, artifact.coordE, artifact.coordN))
    return { ok: false, reason: "坐标冲突" };
  return { ok: true, reason: null };
}

export interface PendingSummary {
  openBags: SampleBag[];
  queued: Artifact[];
}

/** 待处理：未封袋 + 排队未装袋 */
export function pendingSummary(state: ArchiveState, unitId: string): PendingSummary {
  return {
    openBags: state.bags.filter((b) => b.unitId === unitId && b.status === "open"),
    queued: state.artifacts.filter(
      (a) => a.unitId === unitId && a.status === "queued"
    ),
  };
}

/** 封存申请通过的前置条件：没有待处理袋、没有坐标冲突 */
export function sealBlockers(state: ArchiveState, unitId: string): string[] {
  const blockers: string[] = [];
  const { openBags, queued } = pendingSummary(state, unitId);
  if (openBags.length > 0) {
    const items = openBags.reduce((sum, b) => sum + b.itemIds.length, 0);
    blockers.push(`${openBags.length} 只取样袋待封袋（共 ${items} 件）`);
  }
  if (queued.length > 0) blockers.push(`${queued.length} 件出土物排队待装袋`);
  const conflicts = coordConflicts(state, unitId);
  if (conflicts.length > 0) blockers.push(`${conflicts.length} 处出土物坐标冲突`);
  return blockers;
}

/** 稳定序列化（键排序），保证同一状态得到同一摘要 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v));
  return "{" + entries.join(",") + "}";
}

/** FNV-1a 摘要：页面与导出据此校验同一依据 */
export function digestOf(value: unknown): string {
  const s = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * 汇总探方封存依据：已封袋用封袋时的快照（保留原依据），
 * 待处理与冲突实时计算；页面展示与文件导出共用本函数。
 */
export function buildSealingBasis(state: ArchiveState, unitId: string): SealingBasis {
  const unit = getUnit(state, unitId);
  const layers = state.layers.filter((l) => l.unitId === unitId);
  const app = state.applications.find((a) => a.unitId === unitId) ?? null;
  const artifactById = new Map(state.artifacts.map((a) => [a.id, a]));

  const sealedBags = state.bags
    .filter((b) => b.unitId === unitId && b.status === "sealed" && b.basis !== null)
    .sort((a, b) => ((a.bagNo ?? "") < (b.bagNo ?? "") ? -1 : 1))
    .map((b) => {
      const basis = b.basis!;
      return {
        bagNo: basis.bagNo,
        layerId: basis.layerId,
        layerName: layerName(state, basis.layerId),
        layerVersion: basis.layerVersion,
        appVersion: basis.appVersion,
        itemCount: basis.itemCount,
        totalWeightG: basis.totalWeightG,
        items: basis.itemIds.map((id) => {
          const a = artifactById.get(id);
          return {
            id,
            name: a?.name ?? id,
            coord: a ? `E${a.coordE}N${a.coordN}` : "-",
            weightG: a?.weightG ?? 0,
          };
        }),
      };
    });

  const pending = pendingSummary(state, unitId);
  const conflicts = coordConflicts(state, unitId);

  const core = {
    unitId: unit.id,
    unitName: unit.name,
    grid: { e: unit.gridE, n: unit.gridN },
    unitStatus: unit.status,
    layers: layers.map((l) => ({ id: l.id, name: l.name, version: l.version })),
    application: app
      ? { version: app.version, status: app.status, note: app.note }
      : null,
    sealedBags,
    pending: {
      openBags: pending.openBags.map((b) => ({
        id: b.id,
        layerId: b.layerId,
        items: b.itemIds.length,
        totalWeightG: b.totalWeightG,
      })),
      queuedArtifactIds: pending.queued.map((a) => a.id),
    },
    conflicts: conflicts.map((a) => ({
      id: a.id,
      name: a.name,
      coord: `E${a.coordE}N${a.coordN}`,
    })),
  };
  return { ...core, digest: digestOf(core) };
}
