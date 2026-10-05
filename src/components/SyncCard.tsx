import { resetAllStorage, useStore } from "../store";

export default function SyncCard() {
  const { state, dispatch, syncNow, syncing } = useStore();
  const pending = state.outbox.filter((o) => o.status !== "done");
  const failed = pending.filter((o) => o.status === "failed");
  const done = state.outbox.length - pending.length;

  return (
    <div className="stack-card sync-card">
      <div className="sync-head">
        <span className={`status-dot ${state.online ? "on" : "off"}`} />
        <strong>{state.online ? "在线" : "断网 · 本地记录中"}</strong>
        <span className="muted">窗口 #{state.sessionId}</span>
      </div>
      <div className="sync-stats">
        <span>待同步 {pending.length}</span>
        <span className={failed.length ? "danger-text" : ""}>失败 {failed.length}</span>
        <span>已入库 {done}</span>
      </div>
      <div className="sync-actions">
        <button
          className={state.online ? "" : "primary-action"}
          onClick={() => dispatch({ type: "set-online", online: !state.online })}
        >
          {state.online ? "断开网络" : "回连"}
        </button>
        <button
          disabled={!state.online || syncing || !pending.length}
          onClick={() => void syncNow()}
        >
          {syncing ? "同步中…" : failed.length ? "重试未完成项" : "立即同步"}
        </button>
      </div>
      <label className="fault-toggle">
        <input
          type="checkbox"
          checked={state.faultSealApi}
          onChange={(e) => dispatch({ type: "set-fault", on: e.target.checked })}
        />
        <span>模拟封口登记接口故障</span>
      </label>
      <p className="sync-hint muted">
        断网后操作先记本地；另开一个浏览器窗口可同时提交同一袋号，先到者生效。
      </p>
      <button
        className="btn-danger btn-sm"
        onClick={() => {
          if (window.confirm("清空本窗口本地库与远端档案库，恢复示例数据？")) {
            resetAllStorage();
            dispatch({ type: "reset-all" });
          }
        }}
      >
        重置演示数据
      </button>
    </div>
  );
}
