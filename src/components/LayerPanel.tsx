import { useState } from "react";
import type { ArchiveState } from "../domain/types";
import type { ArchiveActions } from "../store/useArchive";
import { StatusChip } from "./StatusChip";

/** 地层版本与探方网格：换版 / 调网格都会触发未封袋失效重算或坐标冲突 */
export function LayerPanel({
  state,
  actions,
  unitId,
}: {
  state: ArchiveState;
  actions: ArchiveActions;
  unitId: string;
}) {
  const unit = state.units.find((u) => u.id === unitId)!;
  const layers = state.layers.filter((l) => l.unitId === unitId);
  const [gridE, setGridE] = useState(unit.gridE);
  const [gridN, setGridN] = useState(unit.gridN);
  const sealed = unit.status === "sealed";

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>地层关系</p>
          <h2>地层与网格</h2>
        </div>
        <StatusChip kind="unit" status={unit.status} />
      </div>
      <div className="layer-list">
        {layers.map((layer) => (
          <div className="layer-row" key={layer.id}>
            <div>
              <strong>{layer.name}</strong>
              <span className="muted">
                {layer.soil} · v{layer.version}
              </span>
            </div>
            <button
              disabled={sealed}
              title={sealed ? "探方已封存" : "换版后未封袋记录失效重算"}
              onClick={() => actions.bumpLayer(layer.id)}
            >
              换版
            </button>
          </div>
        ))}
      </div>
      <div className="grid-resize">
        <span className="muted">网格调整（可能产生坐标冲突）</span>
        <div className="inline-fields">
          <label>
            <span>E 列</span>
            <input
              type="number"
              min={1}
              max={12}
              value={gridE}
              onChange={(ev) => setGridE(Number(ev.target.value))}
            />
          </label>
          <label>
            <span>N 行</span>
            <input
              type="number"
              min={1}
              max={12}
              value={gridN}
              onChange={(ev) => setGridN(Number(ev.target.value))}
            />
          </label>
          <button
            disabled={sealed}
            onClick={() => actions.resizeGrid(unitId, gridE, gridN)}
          >
            调整
          </button>
        </div>
      </div>
    </section>
  );
}
