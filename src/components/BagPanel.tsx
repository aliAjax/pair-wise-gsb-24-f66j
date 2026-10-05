import { useStore } from "../store";
import * as R from "../rules";
import { BAG_MAX_ITEMS, BAG_MAX_WEIGHT } from "../types";

const BAG_STATUS: Record<string, [string, string]> = {
  open: ["未封袋", "chip-warn"],
  sealed: ["已封袋", "chip-ok"],
  void: ["已作废", "chip-muted"],
};

export default function BagPanel() {
  const { state, dispatch } = useStore();
  const unit = state.units.find((u) => u.id === state.selectedUnitId)!;
  const bags = state.bags.filter((b) => b.unitId === unit.id);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>同探方同地层 · 已登记未运走才可入袋</p>
          <h2>取样袋（{unit.id}）</h2>
        </div>
        <span className="muted">
          上限 {BAG_MAX_ITEMS} 件 / {R.fmtWeight(BAG_MAX_WEIGHT)}
        </span>
      </div>
      <div className="bag-list">
        {bags.map((b) => {
          const [text, cls] = BAG_STATUS[b.status];
          const countPct = Math.min(100, (b.items.length / BAG_MAX_ITEMS) * 100);
          const weightPct = Math.min(100, (b.totalWeight / BAG_MAX_WEIGHT) * 100);
          const layer = state.layers.find((l) => l.id === b.layerId);
          return (
            <article key={b.id} className={`bag-card ${b.status}`}>
              <div className="bag-head">
                <strong>{b.bagNo}</strong>
                <i className={`chip ${cls}`}>{text}</i>
                <span className="muted">
                  {layer?.code} {layer?.name} · 依据 {R.basisText(b.basis)}
                  {b.status === "sealed" && "（原依据保留）"}
                </span>
              </div>
              <div className="bag-meta">
                <span>
                  {b.items.length} 件 · {R.fmtWeight(b.totalWeight)}
                </span>
                <span className="limit-bar">
                  <i style={{ width: `${countPct}%` }} />
                </span>
                <span className="limit-bar">
                  <i style={{ width: `${weightPct}%` }} />
                </span>
              </div>
              <p className="bag-items muted">
                {b.items.map((i) => `${i.name}（${i.weight}g）`).join("、")}
              </p>
              {b.status === "void" && <p className="danger-text">作废原因：{b.voidReason}</p>}
              {b.status === "sealed" && b.sealedAt && (
                <p className="muted">封存时间：{new Date(b.sealedAt).toLocaleString("zh-CN")}</p>
              )}
              {b.status === "open" && (
                <button
                  className="primary-action btn-sm"
                  disabled={unit.status === "sealed"}
                  onClick={() => dispatch({ type: "seal-bag", bagId: b.id })}
                >
                  封袋
                </button>
              )}
            </article>
          );
        })}
        {!bags.length && <p className="muted empty-line">暂无取样袋：在出土物列表勾选后“申请装袋”。</p>}
      </div>
    </section>
  );
}
