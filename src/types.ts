// 领域模型：探方 / 地层 / 出土物 / 取样袋 / 封存申请 / 离线回传队列

export const BAG_MAX_ITEMS = 12; // 单袋件数上限
export const BAG_MAX_WEIGHT = 3000; // 单袋总重上限（克）

export interface GridUnit {
  id: string; // 探方号，如 T0203
  kind: string; // 遗迹类型（灰坑 / 墓葬 / 房址 / 沟状遗迹）
  east: number; // 网格东西宽（米）
  north: number; // 网格南北宽（米）
  status: "open" | "sealed";
}

export interface Layer {
  id: string;
  unitId: string;
  code: string; // 地层代号：③ / H12 / F2
  name: string;
  soil: string; // 土色土质
  depth: string; // 深度区间
  version: number; // 地层版本，换版 +1
}

export type ArtifactStatus = "registered" | "bagged" | "sealed" | "shipped";

export interface Artifact {
  id: string;
  unitId: string;
  layerId: string;
  name: string;
  weight: number; // 克
  e: number; // 坐标点 E（米）
  n: number; // 坐标点 N（米）
  status: ArtifactStatus;
  bagNo?: string;
  registeredAt: number;
}

/** 封存依据快照：封袋时的地层版本 + 封存申请版次 */
export interface BagBasis {
  layerVersion: number;
  appRevision: number;
}

export type BagStatus = "open" | "sealed" | "void";

export interface BagItemSnapshot {
  id: string;
  name: string;
  weight: number;
}

export interface SampleBag {
  id: string; // 本地袋记录 id
  bagNo: string; // 袋号：装袋成功才分配，排队不占号
  unitId: string;
  layerId: string;
  basis: BagBasis;
  items: BagItemSnapshot[];
  totalWeight: number;
  status: BagStatus;
  voidReason?: string;
  origin: string; // 创建窗口号（双窗口先到者生效判定用）
  createdAt: number;
  sealedAt?: number;
}

export interface QueueRequest {
  id: string;
  unitId: string;
  layerId: string;
  itemIds: string[];
  reason: "超限排队" | "失效重算";
  status: "queued" | "done" | "cancelled";
  note?: string;
  createdAt: number;
}

export interface SealApplication {
  unitId: string;
  revision: number; // 申请版次，变更 +1
  note: string;
  status: "draft" | "approved" | "rejected";
  updatedAt: number;
  decidedAt?: number;
}

export type OutboxKind =
  | "artifact-register"
  | "artifact-update"
  | "bag-create"
  | "bag-seal"
  | "bag-void";

export interface OutboxOp {
  id: string;
  kind: OutboxKind;
  label: string;
  payload: Record<string, unknown>;
  status: "pending" | "done" | "failed";
  error?: string;
  attempts: number;
  createdAt: number;
}

export interface LogEntry {
  time: number;
  text: string;
}

export interface AppState {
  schema: number;
  sessionId: string; // 本窗口编号
  units: GridUnit[];
  layers: Layer[];
  artifacts: Artifact[];
  bags: SampleBag[];
  queue: QueueRequest[];
  applications: SealApplication[];
  bagSeq: Record<string, number>; // "unitId|layerId" -> 已发袋号
  selectedUnitId: string;
  selectedLayerByUnit: Record<string, string>;
  kindFilter: string | null;
  online: boolean;
  faultSealApi: boolean; // 模拟封口登记接口故障
  outbox: OutboxOp[];
  log: LogEntry[];
}
