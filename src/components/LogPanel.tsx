import { useStore } from "../store";
import { fmtTime } from "../rules";

const OP_STATUS: Record<string, [string, string]> = {
  pending: ["待处理", "chip-warn"],
  done: ["已入库", "chip-ok"],
  failed: ["失败", "chip-danger"],
};

export default function LogPanel() {
  const { state } = useStore();

  return (
    <section className="bottom-grid">
      <div className="panel">
        <div className="section-heading">
          <div>
            <p>本地待发 · 回连逐条合并</p>
            <h2>回传队列</h2>
          </div>
          <span className="muted">失败只重试未完成项</span>
        </div>
        <div className="op-list">
          {state.outbox.map((o) => {
            const [text, cls] = OP_STATUS[o.status];
            return (
              <div key={o.id} className="op-row">
                <i className={`chip ${cls}`}>{text}</i>
                <span className="op-label">{o.label}</span>
                <span className="muted">尝试 {o.attempts} 次</span>
                {o.error && <span className="danger-text">{o.error}</span>}
              </div>
            );
          })}
          {!state.outbox.length && <p className="muted empty-line">暂无回传记录。</p>}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <div>
            <p>登记 · 装袋 · 封存 · 同步</p>
            <h2>流转记录</h2>
          </div>
        </div>
        <div className="log-list">
          {state.log.map((l, i) => (
            <p key={`${l.time}-${i}`}>
              <span className="muted">{fmtTime(l.time)}</span> {l.text}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
