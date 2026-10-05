import { useState } from "react";
import { useStore } from "../store";
import * as R from "../rules";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const APP_STATUS: Record<string, [string, string]> = {
  draft: ["草稿", "chip-info"],
  approved: ["已通过", "chip-ok"],
  rejected: ["已驳回", "chip-danger"],
};

export default function SealPanel() {
  const { state, dispatch } = useStore();
  const unit = state.units.find((u) => u.id === state.selectedUnitId)!;
  const app = state.applications.find((a) => a.unitId === unit.id);
  const [note, setNote] = useState("");
  const [showBasis, setShowBasis] = useState(false);

  const blk = R.sealBlockers(state, unit.id);
  const ok = R.canApprove(blk);
  const report = R.buildBasisReport(state, unit.id);

  function exportBasis() {
    const rev = app?.revision ?? 0;
    downloadJson(`封存依据-${unit.id}-r${rev}.json`, report);
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>没有待处理袋和坐标冲突才能通过</p>
          <h2>探方封存申请（{unit.id}）</h2>
        </div>
        {app && (
          <span className={`chip ${APP_STATUS[app.status][1]}`}>
            {APP_STATUS[app.status][0]} · r{app.revision}
          </span>
        )}
      </div>

      {!app && unit.status !== "sealed" && (
        <div className="apply-form">
          <textarea
            placeholder="封存范围与说明，如：T0203 第3层出土物整理完毕，申请封存"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="primary-action"
            disabled={!note.trim()}
            onClick={() => {
              dispatch({ type: "create-application", unitId: unit.id, note: note.trim() });
              setNote("");
            }}
          >
            建立封存申请
          </button>
        </div>
      )}

      {app && (
        <>
          <p className="muted app-note">{app.note}</p>
          <ul className="check-list">
            <li className={blk.openBags.length ? "bad" : "ok"}>
              未封袋 {blk.openBags.length} 个
              {blk.openBags.length > 0 && `（${blk.openBags.map((b) => b.bagNo).join("、")}）`}
            </li>
            <li className={blk.queuedRequests.length ? "bad" : "ok"}>
              排队单 {blk.queuedRequests.length} 张
            </li>
            <li className={blk.conflicts.length ? "bad" : "ok"}>
              坐标冲突 {blk.conflicts.length} 件
              {blk.conflicts.length > 0 && `（${blk.conflicts.map((a) => a.name).join("、")}）`}
            </li>
          </ul>

          {unit.status !== "sealed" && (
            <div className="apply-form">
              <textarea
                placeholder="变更说明（变更后未封袋记录失效重算，已封袋保留原依据）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="row-actions">
                <button
                  className="primary-action"
                  disabled={!ok}
                  title={ok ? "" : "须先清零待处理袋与坐标冲突"}
                  onClick={() => dispatch({ type: "approve-application", unitId: unit.id })}
                >
                  通过申请
                </button>
                <button
                  disabled={app.status !== "draft"}
                  onClick={() => dispatch({ type: "reject-application", unitId: unit.id })}
                >
                  驳回
                </button>
                <button
                  disabled={!note.trim()}
                  onClick={() => {
                    dispatch({ type: "change-application", unitId: unit.id, note: note.trim() });
                    setNote("");
                  }}
                >
                  变更申请
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {unit.status === "sealed" && (
        <p className="sealed-banner">探方 {unit.id} 已封存，登记、装袋、换版与申请变更均已锁定。</p>
      )}

      <div className="basis-block">
        <div className="row-actions">
          <button className="btn-sm" onClick={() => setShowBasis((v) => !v)}>
            {showBasis ? "收起依据预览" : "依据预览"}
          </button>
          <button className="btn-sm primary-action" onClick={exportBasis}>
            导出封存依据（JSON）
          </button>
          <span className="muted">页面与导出同源</span>
        </div>
        {showBasis && <pre className="basis-preview">{JSON.stringify(report, null, 2)}</pre>}
      </div>
    </section>
  );
}
