import { useState } from "react";
import { bagEligibility, coordConflicts, isCoordInside } from "../domain/rules";
import type { ArchiveState, Artifact, ExcavationUnit } from "../domain/types";
import type { ArchiveActions } from "../store/useArchive";
import { StatusChip } from "./StatusChip";

function ConflictRow({
  artifact,
  unit,
  onFix,
}: {
  artifact: Artifact;
  unit: ExcavationUnit;
  onFix: (id: string, e: number, n: number) => void;
}) {
  const [e, setE] = useState(artifact.coordE);
  const [n, setN] = useState(artifact.coordN);
  return (
    <div className="conflict-row">
      <span>
        {artifact.id} {artifact.name}：E{artifact.coordE}N{artifact.coordN} 超出网格
      </span>
      <input
        type="number"
        min={1}
        max={unit.gridE}
        value={e}
        onChange={(ev) => setE(Number(ev.target.value))}
      />
      <input
        type="number"
        min={1}
        max={unit.gridN}
        value={n}
        onChange={(ev) => setN(Number(ev.target.value))}
      />
      <button onClick={() => onFix(artifact.id, e, n)}>修正坐标</button>
    </div>
  );
}

/** 出土物登记与列表：坐标必须落进探方网格，冲突件单独列出待修正 */
export function ArtifactPanel({
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
  const artifacts = state.artifacts.filter((a) => a.unitId === unitId);
  const conflicts = coordConflicts(state, unitId);
  const bagById = new Map(state.bags.map((b) => [b.id, b]));

  const [name, setName] = useState("");
  const [layerId, setLayerId] = useState(layers[0]?.id ?? "");
  const [e, setE] = useState(1);
  const [n, setN] = useState(1);
  const [weight, setWeight] = useState(100);

  const sealed = unit.status === "sealed";
  const coordOk = isCoordInside(unit, e, n);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    actions.register(unitId, layerId, name, e, n, weight);
    setName("");
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>出土物档案</p>
          <h2>登记与装袋</h2>
        </div>
        <span className="muted">坐标必须落进 {unit.id} 网格</span>
      </div>

      <form className="field-grid" onSubmit={submit}>
        <label>
          <span>名称</span>
          <input
            value={name}
            placeholder="如：陶片·绳纹"
            onChange={(ev) => setName(ev.target.value)}
          />
        </label>
        <label>
          <span>地层</span>
          <select value={layerId} onChange={(ev) => setLayerId(ev.target.value)}>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}（v{l.version}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>坐标 E（1–{unit.gridE}）</span>
          <input
            type="number"
            value={e}
            onChange={(ev) => setE(Number(ev.target.value))}
          />
        </label>
        <label>
          <span>坐标 N（1–{unit.gridN}）</span>
          <input
            type="number"
            value={n}
            onChange={(ev) => setN(Number(ev.target.value))}
          />
        </label>
        <label>
          <span>重量（g）</span>
          <input
            type="number"
            min={1}
            value={weight}
            onChange={(ev) => setWeight(Number(ev.target.value))}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="primary-action" disabled={sealed || !coordOk}>
            登记出土物
          </button>
          {!coordOk && <span className="hint-danger">坐标超出网格，无法登记</span>}
          {sealed && <span className="muted">探方已封存</span>}
        </div>
      </form>

      {conflicts.length > 0 && (
        <div className="conflict-box">
          <strong>坐标冲突 {conflicts.length} 处（修正前不能装袋、封存审批不通过）</strong>
          {conflicts.map((a) => (
            <ConflictRow
              key={a.id}
              artifact={a}
              unit={unit}
              onFix={(id, ce, cn) => actions.fixCoord(id, ce, cn)}
            />
          ))}
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>名称</th>
            <th>地层</th>
            <th>坐标</th>
            <th>重量</th>
            <th>状态</th>
            <th>袋</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((a) => {
            const layer = state.layers.find((l) => l.id === a.layerId);
            const eligibility = bagEligibility(state, a);
            const bag = a.bagId ? bagById.get(a.bagId) : undefined;
            return (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.name}</td>
                <td>
                  {layer?.name} <span className="muted">v{a.layerVersion}</span>
                </td>
                <td>
                  E{a.coordE}N{a.coordN}
                </td>
                <td>{a.weightG}g</td>
                <td>
                  <StatusChip kind="artifact" status={a.status} />
                </td>
                <td>
                  {bag ? bag.bagNo ?? `${bag.id}（未分配袋号）` : "—"}
                </td>
                <td className="row-actions">
                  {a.status === "registered" && (
                    <button
                      disabled={!eligibility.ok}
                      title={eligibility.reason ?? "装入同探方同地层取样袋"}
                      onClick={() => actions.addToBag(a.id)}
                    >
                      装袋
                    </button>
                  )}
                  {(a.status === "registered" || a.status === "queued") && (
                    <button onClick={() => actions.transport(a.id)}>运走</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
