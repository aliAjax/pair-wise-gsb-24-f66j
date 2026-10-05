import type { AppState, Artifact, Layer } from "./types";

export const SCHEMA_VERSION = 1;

const T0 = Date.parse("2026-09-28T08:30:00+08:00");

function artifact(
  id: string,
  unitId: string,
  layerId: string,
  name: string,
  weight: number,
  e: number,
  n: number,
  status: Artifact["status"] = "registered"
): Artifact {
  return { id, unitId, layerId, name, weight, e, n, status, registeredAt: T0 };
}

/** 示例记录：在原有 T0203 / T0204 / T0301 三条记录基础上展开为可续作数据 */
export function seedState(sessionId: string): AppState {
  const layers: Layer[] = [
    { id: "L-T0203-3", unitId: "T0203", code: "③", name: "第3层", soil: "灰褐土", depth: "0.8–1.4m", version: 1 },
    { id: "L-T0204-H12", unitId: "T0204", code: "H12", name: "H12灰坑", soil: "黑褐土，夹炭屑", depth: "1.2–2.0m", version: 1 },
    { id: "L-T0301-F2", unitId: "T0301", code: "F2", name: "F2房址", soil: "夯土面", depth: "0.5–0.9m", version: 1 },
  ];

  // T0203 第3层：陶片14件（示例记录“陶片12件，坐标E3N4”的扩展登记）
  const t0203: Artifact[] = [
    ["陶片01（夹砂红陶）", 320, 3.0, 4.0],
    ["陶片02（泥质灰陶）", 280, 3.2, 3.6],
    ["陶片03（夹蚌陶）", 260, 2.8, 4.2],
    ["陶片04（泥质灰陶）", 240, 1.5, 2.5],
    ["陶片05（夹砂红陶）", 220, 1.8, 2.1],
    ["陶片06（磨光黑陶）", 200, 2.2, 1.6],
    ["陶片07（夹砂红陶）", 310, 4.1, 3.3],
    ["陶片08（泥质灰陶）", 290, 4.4, 2.8],
    ["陶片09（夹蚌陶）", 270, 3.7, 1.9],
    ["陶片10（泥质灰陶）", 250, 0.9, 3.8],
    ["陶片11（夹砂红陶）", 230, 1.2, 4.4],
    ["陶片12（泥质灰陶）", 210, 2.6, 0.8],
    ["陶片13（夹砂红陶）", 180, 3.4, 1.2],
    ["陶片14（泥质灰陶）", 160, 4.6, 4.5],
  ].map(([name, w, e, n], i) =>
    artifact(`A-T0203-${String(i + 1).padStart(3, "0")}`, "T0203", "L-T0203-3", name as string, w as number, e as number, n as number)
  );

  // T0204 H12灰坑：动物骨骼（示例记录“夹炭屑，见动物骨”），其中骨片已运走
  const t0204: Artifact[] = [
    artifact("A-T0204-001", "T0204", "L-T0204-H12", "兽骨（犬）", 450, 1.2, 2.3),
    artifact("A-T0204-002", "T0204", "L-T0204-H12", "骨锥", 90, 2.1, 1.4),
    artifact("A-T0204-003", "T0204", "L-T0204-H12", "骨片", 120, 3.3, 3.1, "shipped"),
    artifact("A-T0204-004", "T0204", "L-T0204-H12", "炭化粟样", 60, 0.8, 4.2),
  ];

  // T0301 F2房址：柱洞土样（示例记录“柱洞关系需复核”），夯土块坐标出格 → 坐标冲突示例
  const t0301: Artifact[] = [
    artifact("A-T0301-001", "T0301", "L-T0301-F2", "柱洞土样A", 800, 1.5, 1.5),
    artifact("A-T0301-002", "T0301", "L-T0301-F2", "柱洞土样B", 760, 2.5, 2.0),
    artifact("A-T0301-003", "T0301", "L-T0301-F2", "夯土块", 950, 4.6, 3.2),
  ];

  return {
    schema: SCHEMA_VERSION,
    sessionId,
    units: [
      { id: "T0203", kind: "沟状遗迹", east: 5, north: 5, status: "open" },
      { id: "T0204", kind: "灰坑", east: 5, north: 5, status: "open" },
      { id: "T0301", kind: "房址", east: 4, north: 4, status: "open" },
    ],
    layers,
    artifacts: [...t0203, ...t0204, ...t0301],
    bags: [],
    queue: [],
    applications: [],
    bagSeq: {},
    selectedUnitId: "T0203",
    selectedLayerByUnit: {},
    kindFilter: null,
    online: true,
    faultSealApi: false,
    outbox: [],
    log: [{ time: T0, text: "已载入示例数据：3 个探方 / 3 个地层 / 21 件出土物，可继续登记、装袋与封存。" }],
  };
}
