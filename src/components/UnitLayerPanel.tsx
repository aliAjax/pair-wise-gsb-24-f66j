import { useStore } from "../store";

const ROLES = ["发掘队员", "领队", "资料整理员"];
const KINDS = ["灰坑", "墓葬", "房址", "沟状遗迹"];

export default function UnitLayerPanel() {
  const { state, dispatch } = useStore();
  const units = state.units.filter((u) => !state.kindFilter || u.kind === state.kindFilter);
  const layers = state.layers.filter((l) => l.unitId === state.selectedUnitId);
  const unit = state.units.find((u) => u.id === state.selectedUnitId);

  return (
    <aside className="panel narrow">
      <h2>角色</h2>
      <div className="chips">
        {ROLES.map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>

      <h2>筛选</h2>
      <div className="chips muted">
        {KINDS.map((k) => (
          <button
            key={k}
            className={state.kindFilter === k ? "chip-active" : ""}
            onClick={() =>
              dispatch({ type: "set-filter", filter: state.kindFilter === k ? null : k })
            }
          >
            {k}
          </button>
        ))}
      </div>

      <h2>探方</h2>
      <div className="unit-list">
        {units.map((u) => (
          <button
            key={u.id}
            className={`unit-item ${u.id === state.selectedUnitId ? "active" : ""}`}
            onClick={() => dispatch({ type: "select-unit", unitId: u.id })}
          >
            <strong>{u.id}</strong>
            <span className="muted">
              {u.kind} · 网格 {u.east}×{u.north}m
            </span>
            {u.status === "sealed" && <i className="chip chip-primary">已封存</i>}
          </button>
        ))}
        {!units.length && <p className="muted">该分类下暂无探方</p>}
      </div>

      <h2>地层</h2>
      <div className="layer-list">
        {layers.map((l) => (
          <div key={l.id} className="layer-row">
            <div>
              <strong>
                {l.code} {l.name}
              </strong>
              <span className="chip chip-info">v{l.version}</span>
              <p className="muted">
                {l.soil} · {l.depth}
              </p>
            </div>
            <button
              className="btn-sm"
              disabled={unit?.status === "sealed"}
              title="换版后未封袋记录失效重算，已封袋保留原依据"
              onClick={() => dispatch({ type: "bump-layer", layerId: l.id })}
            >
              换版
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
