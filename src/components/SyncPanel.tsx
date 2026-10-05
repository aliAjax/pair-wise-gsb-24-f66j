import type { ArchiveState } from "../domain/types";
import { loadRemote, WINDOW_ID } from "../store/remote";
import type { ArchiveActions } from "../store/useArchive";

/** 断网 / 回连 / outbox 回传 / 远端库视图 / 操作日志 */
export function SyncPanel({
  state,
  actions,
}: {
  state: ArchiveState;
  actions: ArchiveActions;
}) {
  const remote = loadRemote();
  const remoteBagNos = Object.keys(remote.bags).sort();
  const remoteItemCount = Object.keys(remote.items).length;
  const pendingOps = state.outbox.filter((o) => o.status !== "done");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>本地 outbox · {WINDOW_ID}</p>
          <h2>断网与回传</h2>
        </div>
        <span className={`chip ${state.online ? "chip-approved" : "chip-invalidated"}`}>
          {state.online ? "在线" : "断网"}
        </span>
      </div>

      <div className="btn-row wrap">
        <button onClick={() => actions.setOnline(!state.online)}>
          {state.online ? "模拟断网" : "回连"}
        </button>
        <button onClick={actions.syncNow} disabled={!state.online}>
          立即同步{pendingOps.length > 0 ? `（${pendingOps.length} 项）` : ""}
        </button>
        <button onClick={actions.resyncAll}>重复回传（幂等）</button>
        <button onClick={actions.compete}>模拟另一窗口抢注袋号</button>
        <button
          className={state.simulateFailure ? "danger-action" : ""}
          onClick={actions.toggleFailure}
        >
          {state.simulateFailure ? "关闭写入故障" : "模拟写入故障"}
        </button>
        <button
          onClick={() => {
            if (window.confirm("重置全部本地与远端数据，回到示例记录？")) actions.reset();
          }}
        >
          重置数据
        </button>
      </div>

      {state.outbox.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>回传任务</th>
              <th>袋号</th>
              <th>窗口</th>
              <th>逐件进度</th>
              <th>尝试</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {state.outbox.map((op) => (
              <tr key={op.opId}>
                <td>{op.opId}</td>
                <td>{op.bagNo}</td>
                <td>{op.windowId}</td>
                <td>
                  <code className="item-marks">
                    {op.items.map((i) => (i.done ? "✓" : "·")).join("")}
                  </code>
                  <span className="muted">
                    {" "}
                    {op.items.filter((i) => i.done).length}/{op.items.length}
                  </span>
                </td>
                <td>{op.attempts}</td>
                <td>
                  <span className={`chip ${op.status === "done" ? "chip-approved" : "chip-queued"}`}>
                    {op.status === "done" ? "已入库" : "待回传"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small">
        远端库：袋号 {remoteBagNos.length > 0 ? remoteBagNos.join("、") : "（空）"} · 已入库{" "}
        {remoteItemCount} 件 · 袋号计数 {remote.seq}
      </p>

      <div className="log-list">
        {state.log.map((line, i) => (
          <p key={`${i}-${line}`}>{line}</p>
        ))}
      </div>
    </section>
  );
}
