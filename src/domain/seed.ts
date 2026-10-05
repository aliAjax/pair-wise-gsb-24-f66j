import type { ArchiveState, Artifact } from "./types";

let artifactSeq = 1;
function seedArtifact(
  unitId: string,
  layerId: string,
  name: string,
  coordE: number,
  coordN: number,
  weightG: number
): Artifact {
  return {
    id: `A-${String(artifactSeq++).padStart(4, "0")}`,
    unitId,
    layerId,
    layerVersion: 1,
    name,
    coordE,
    coordN,
    weightG,
    status: "registered",
    bagId: null,
  };
}

/** 初始示例数据：3 个探方 / 5 个地层 / 12 件出土物 */
export function buildSeedState(): ArchiveState {
  artifactSeq = 1;
  return {
    units: [
      { id: "T0203", name: "T0203", gridE: 5, gridN: 5, status: "open" },
      { id: "T0204", name: "T0204", gridE: 4, gridN: 5, status: "open" },
      { id: "T0301", name: "T0301", gridE: 4, gridN: 4, status: "open" },
    ],
    layers: [
      { id: "L-T0203-1", unitId: "T0203", name: "第1层", soil: "耕土", version: 1 },
      { id: "L-T0203-2", unitId: "T0203", name: "第2层", soil: "黄褐土", version: 1 },
      { id: "L-T0203-3", unitId: "T0203", name: "第3层", soil: "灰褐土", version: 1 },
      { id: "L-T0204-H12", unitId: "T0204", name: "H12灰坑", soil: "黑褐土", version: 1 },
      { id: "L-T0301-F2", unitId: "T0301", name: "F2房址", soil: "夯土面", version: 1 },
    ],
    artifacts: [
      seedArtifact("T0203", "L-T0203-3", "陶片·绳纹", 3, 4, 126),
      seedArtifact("T0203", "L-T0203-3", "陶片·素面", 3, 4, 98),
      seedArtifact("T0203", "L-T0203-3", "陶片·附加堆纹", 2, 4, 154),
      seedArtifact("T0203", "L-T0203-3", "石斧残件", 4, 2, 420),
      seedArtifact("T0203", "L-T0203-3", "陶纺轮", 1, 3, 66),
      seedArtifact("T0203", "L-T0203-3", "骨锥", 5, 5, 38),
      seedArtifact("T0203", "L-T0203-3", "陶片·篮纹", 2, 2, 143),
      seedArtifact("T0203", "L-T0203-3", "炭化粟粒", 3, 3, 12),
      seedArtifact("T0203", "L-T0203-2", "陶片·磨光", 4, 4, 110),
      seedArtifact("T0204", "L-T0204-H12", "动物骨骼", 2, 3, 260),
      seedArtifact("T0204", "L-T0204-H12", "炭屑样本", 2, 3, 45),
      seedArtifact("T0301", "L-T0301-F2", "夯土块", 1, 1, 500),
    ],
    bags: [],
    applications: [
      {
        id: "S-T0203",
        unitId: "T0203",
        version: 1,
        status: "draft",
        note: "2026 年度 T0203 阶段性封存",
        updatedAt: Date.now(),
      },
    ],
    outbox: [],
    seq: { artifact: 13, bagInternal: 1, bag: 1, op: 1 },
    online: true,
    simulateFailure: false,
    log: ["示例数据已载入：3 个探方 / 5 个地层 / 12 件出土物"],
  };
}
