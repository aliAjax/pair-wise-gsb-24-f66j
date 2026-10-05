import { useMemo, useState } from "react";
import { buildSealingBasis, sealBlockers } from "../domain/rules";
import type { ArchiveState } from "../domain/types";
import type { ArchiveActions } from "../store/useArchive";
import { StatusChip } from "./StatusChip";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 封存申请 + 依据摘要 + 导出（页面与导出共用 buildSealingBasis 的同一对象） */
export function SealPanel({
  state,
  actions,
  unitId,
}: {
  state: ArchiveState;
  actions: ArchiveActions;
  unitId: string;
}) {
  const unit = state.units.find((u) => u.id === unitId)!;
  const app = state.applications.find((a) => a.unitId === unitId) ?? null;
  const blockers = sealBlockers(state, unitId);
  const basis = useMemo(() => buildSealingBasis(state, unitId), [state, unitId]);
  const [note, setNote] = useState(app?.note ?? "");
  const [showExport, setShowExport] = useState(false);

  const sealed = unit.status === "sealed";
  const canApprove = app?.status === "submitted" && blockers.length === 0;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>封存申请</p>
          <h2>审批与依据</h2>
        </div>
        {app && <StatusChip kind="app" status={app.status} />}
      </div>

      <label className="stacked">
        <span>申请说明（保存即变更版本，未封袋记录失效重算）</span>
        <textarea
          key={`${unitId}-${app?.version ?? 0}`}
          rows={2}
          defaultValue={app?.note ?? ""}
          placeholder="如：2026 年度阶段性封存"
          disabled={sealed}
          onChange={(ev) => setNote(ev.target.value)}
        />
      </label>

      <div className="btn-row">
        <button disabled={sealed} onClick={() => actions.appSave(unitId, note)}>
          {app ? `保存变更（v${app.version} → v${app.version + 1}）` : "新建申请"}
        </button>
        <button
          disabled={sealed || !app || app.status !== "draft"}
          onClick={() => actions.appSubmit(unitId)}
        >
          提交申请
        </button>
        <button
          className="primary-action"
          disabled={!canApprove}
          title={canApprove ? "无待处理袋与坐标冲突，可通过" : "存在待处理袋或坐标冲突时不能通过"}
          onClick={() => actions.appApprove(unitId)}
        >
          审批通过
        </button>
      </div>

      {blockers.length > 0 ? (
        <ul className="blocker-list">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="ok-line">无待处理袋、无坐标冲突，满足封存条件</p>
      )}

      <div className="basis-box">
        <div className="basis-head">
          <span>封存依据摘要</span>
          <code>{basis.digest}</code>
        </div>
        <p className="muted">
          已封袋 {basis.sealedBags.length} 只 · 待封袋 {basis.pending.openBags.length} 只 ·
          排队 {basis.pending.queuedArtifactIds.length} 件 · 冲突 {basis.conflicts.length} 处
        </p>
        <div className="btn-row">
          <button onClick={() => setShowExport(true)}>查看依据</button>
          <button
            onClick={() =>
              downloadJson(
                `封存依据-${unitId}-v${app?.version ?? 0}-${basis.digest}.json`,
                basis
              )
            }
          >
            导出依据（JSON）
          </button>
        </div>
        <p className="muted small">页面与导出使用同一依据对象，摘要一致。</p>
      </div>

      {showExport && (
        <div className="modal-mask" onClick={() => setShowExport(false)}>
          <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="section-heading">
              <div>
                <p>{unitId} 封存依据</p>
                <h2>摘要 {basis.digest}</h2>
              </div>
              <button onClick={() => setShowExport(false)}>关闭</button>
            </div>
            <pre className="basis-json">{JSON.stringify(basis, null, 2)}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
