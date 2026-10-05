import { useStore } from "../store";
import * as R from "../rules";

export default function QueuePanel() {
  const { state, dispatch } = useStore();
  const unit = state.units.find((u) => u.id === state.selectedUnitId)!;
  const requests = state.queue.filter((q) => q.unitId === unit.id && q.status === "queued");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>超限排队 · 失效重算</p>
          <h2>待处理队列（{unit.id}）</h2>
        </div>
        <span className="muted">排队单不占用袋号，结算时才发号</span>
      </div>
      <div className="queue-list">
        {requests.map((q) => {
          const items = q.itemIds
            .map((id) => state.artifacts.find((a) => a.id === id))
            .filter(Boolean) as { id: string; name: string; weight: number }[];
          const weight = items.reduce((s, i) => s + i.weight, 0);
          const layer = state.layers.find((l) => l.id === q.layerId);
          return (
            <article key={q.id} className="queue-card">
              <div className="bag-head">
                <i className={`chip ${q.reason === "超限排队" ? "chip-warn" : "chip-info"}`}>
                  {q.reason}
                </i>
                <span className="muted">
                  {layer?.code} {layer?.name} · {items.length} 件 / {R.fmtWeight(weight)} · 未分配袋号
                </span>
              </div>
              {q.note && <p className="muted">{q.note}</p>}
              <p className="bag-items muted">{items.map((i) => i.name).join("、")}</p>
              <div className="row-actions">
                <button
                  className="primary-action btn-sm"
                  disabled={unit.status === "sealed"}
                  onClick={() => dispatch({ type: "settle-request", requestId: q.id })}
                >
                  结算装袋
                </button>
                <button
                  className="btn-sm"
                  disabled={unit.status === "sealed"}
                  onClick={() => dispatch({ type: "cancel-request", requestId: q.id })}
                >
                  取消
                </button>
              </div>
            </article>
          );
        })}
        {!requests.length && <p className="muted empty-line">没有待处理袋。</p>}
      </div>
    </section>
  );
}
