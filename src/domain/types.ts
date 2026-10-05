// 探方 / 地层 / 出土物 / 取样袋 / 封存申请 的领域模型

export type UnitStatus = "open" | "sealed";
export type ArtifactStatus = "registered" | "queued" | "bagged" | "sealed" | "transported";
export type BagStatus = "open" | "sealed" | "invalidated";
export type ApplicationStatus = "draft" | "submitted" | "approved";

/** 探方：带 E/N 网格坐标系 */
export interface ExcavationUnit {
  id: string;
  name: string;
  gridE: number; // 网格列数（东）
  gridN: number; // 网格行数（北）
  status: UnitStatus;
}

/** 地层：换版 version 递增，未封袋记录随之失效重算 */
export interface Layer {
  id: string;
  unitId: string;
  name: string;
  soil: string;
  version: number;
}

/** 出土物：坐标必须落在所属探方网格内 */
export interface Artifact {
  id: string;
  unitId: string;
  layerId: string;
  layerVersion: number; // 登记时的地层版本
  name: string;
  coordE: number;
  coordN: number;
  weightG: number;
  status: ArtifactStatus;
  bagId: string | null;
}

/** 封袋时的依据快照：之后地层换版 / 申请变更都不影响已封袋 */
export interface BagBasis {
  bagNo: string;
  unitId: string;
  layerId: string;
  layerVersion: number;
  appVersion: number;
  itemIds: string[];
  itemCount: number;
  totalWeightG: number;
  sealedAt: number;
}

/** 取样袋：袋号仅在封袋时分配，装袋 / 排队阶段不占号 */
export interface SampleBag {
  id: string;
  unitId: string;
  layerId: string;
  layerVersion: number; // 开袋时的地层版本（依据）
  appVersion: number; // 开袋时的封存申请版本（依据）
  bagNo: string | null;
  itemIds: string[];
  totalWeightG: number;
  status: BagStatus;
  sealedAt: number | null;
  basis: BagBasis | null;
}

/** 探方封存申请：每次变更 version 递增 */
export interface SealApplication {
  id: string;
  unitId: string;
  version: number;
  status: ApplicationStatus;
  note: string;
  updatedAt: number;
}

/** 回传条目：幂等键 = 袋号::出土物编号，重复回传只入库一次 */
export interface SyncItem {
  artifactId: string;
  key: string;
  done: boolean;
}

/** 待回连同步的封袋操作（本地 outbox） */
export interface SyncOp {
  opId: string;
  kind: "sealBag";
  windowId: string;
  bagId: string;
  bagNo: string;
  items: SyncItem[];
  status: "pending" | "done";
  attempts: number;
}

export interface ArchiveState {
  units: ExcavationUnit[];
  layers: Layer[];
  artifacts: Artifact[];
  bags: SampleBag[];
  applications: SealApplication[];
  outbox: SyncOp[];
  seq: { artifact: number; bagInternal: number; bag: number; op: number };
  online: boolean;
  simulateFailure: boolean;
  log: string[];
}

/** 封存依据（页面与导出共用同一对象） */
export interface SealingBasis {
  unitId: string;
  unitName: string;
  grid: { e: number; n: number };
  unitStatus: UnitStatus;
  layers: { id: string; name: string; version: number }[];
  application: { version: number; status: ApplicationStatus; note: string } | null;
  sealedBags: {
    bagNo: string;
    layerId: string;
    layerName: string;
    layerVersion: number;
    appVersion: number;
    itemCount: number;
    totalWeightG: number;
    items: { id: string; name: string; coord: string; weightG: number }[];
  }[];
  pending: {
    openBags: { id: string; layerId: string; items: number; totalWeightG: number }[];
    queuedArtifactIds: string[];
  };
  conflicts: { id: string; name: string; coord: string }[];
  digest: string;
}
