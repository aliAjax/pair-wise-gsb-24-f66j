import { useMemo, useState } from "react";
import { useStore } from "../store";
import * as R from "../rules";
import { BAG_MAX_ITEMS, BAG_MAX_WEIGHT } from "../types";

const STATUS_TEXT: Record<string, string> = {
  registered: "已登记",
  bagged: "已装袋",
  sealed: "已封",
  shipped: "已运走",
};

export default function ArtifactPanel() {
  const { state, dispatch } = useStore();
  const unit = state.units.find((u) => u.id === state.selectedUnitId)!;
  const layers = state.layers.filter((l) => l.unitId === unit.id);
  const activeLayerId = state.selectedLayerByUnit[unit.id] ?? layers[0]?.id;
  const activeLayer = layers.find((l) => l.id === activeLayerId);

  const [form, setForm] = useState({ name: "", weight: "", e: "", n: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCoord, setEditCoord] = useState({ e: "", n: "" });

  const queued = R.queuedItemIds(state);
  const artifacts = state.artifacts.filter((a) => a.unitId === unit.id && a.layerId === activeLayerId);

  const selectedItems = useMemo(
    () => artifacts.filter((a) => selected.has(a.id) && a.status === "registered" && !queued.has(a.id)),
    [artifacts, selected, queued]
  );
  const selCheck = R.checkBagLimits(selectedItems);

  const sealed = unit.status === "sealed";

  function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    const weight = Number(form.weight);
    const ce = Number(form.e);
    const cn = Number(form.n);
    if (!form.name.trim() || !(weight > 0) || !Number.isFinite(ce) || !Number.isFinite(cn) || !activeLayer) {
      return;
    }
    dispatch({
      type: "register-artifact",
      input: { unitId: unit.id, layerId: activeLayer.id, name: form.name.trim(), weight, e: ce, n: cn },
    });
    setForm({ name: "", weight: "", e: "", n: "" });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllEligible() {
    setSelected(
      new Set(artifacts.filter((a) => a.status === "registered" && !queued.has(a.id)).map((a) => a.id))
    );
  }

  function requestBag() {
    if (!activeLayer || !selectedItems.length) return;
    dispatch({
      type: "request-bag",
      unitId: unit.id,
      layerId: activeLayer.id,
      itemIds: selectedItems.map((a) => a.id),
    });
    setSelected(new Set());
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>{unit.id} · 网格 {unit.east}×{unit.north}m {sealed ? "· 已封存" : ""}</p>
          <h2>出土物登记与坐标</h2>
        </div>
        <div className="tabs">
          {layers.map((l) => (
            <button
              key={l.id}
              className={`tab ${l.id === activeLayerId ? "active" : ""}`}
              onClick={() => {
                dispatch({ type: "select-layer", unitId: unit.id, layerId: l.id });
                setSelected(new Set());
              }}
            >
              {l.code} {l.name} <i>v{l.version}</i>
            </button>
          ))}
        </div>
      </div>

      {!sealed && activeLayer && (
        <form className="form-row" onSubmit={submitRegister}>
          <input
            placeholder="出土物名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="重量(g)"
            type="number"
            min="0"
            step="0.1"
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: e.target.value })}
          />
          <input
            placeholder={`坐标E (0–${unit.east})`}
            type="number"
            step="0.1"
            value={form.e}
            onChange={(e) => setForm({ ...form, e: e.target.value })}
          />
          <input
            placeholder={`坐标N (0–${unit.north})`}
            type="number"
            step="0.1"
            value={form.n}
            onChange={(e) => setForm({ ...form, n: e.target.value })}
          />
          <button className="primary-action" type="submit">
            登记
          </button>
        </form>
      )}

      <div className="art-table">
        <div className="art-row art-head">
          <span />
          <span>名称</span>
          <span>坐标点</span>
          <span>重量</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {artifacts.map((a) => {
          const conflict = a.status !== "shipped" && R.coordConflict(a, unit);
          const eligible = a.status === "registered" && !queued.has(a.id) && !sealed;
          const editing = editingId === a.id;
          return (
            <div key={a.id} className={`art-row ${conflict ? "conflict" : ""}`}>
              <span>
                <input
                  type="checkbox"
                  disabled={!eligible}
                  checked={selected.has(a.id) && eligible}
                  onChange={() => toggleSelect(a.id)}
                />
              </span>
              <span>
                {a.name}
                {queued.has(a.id) && <i className="chip chip-warn">排队中</i>}
              </span>
              <span>
                {editing ? (
                  <span className="coord-edit">
                    <input
                      type="number"
                      step="0.1"
                      value={editCoord.e}
                      onChange={(e) => setEditCoord({ ...editCoord, e: e.target.value })}
                    />
                    <input
                      type="number"
                      step="0.1"
                      value={editCoord.n}
                      onChange={(e) => setEditCoord({ ...editCoord, n: e.target.value })}
                    />
                  </span>
                ) : (
                  <>
                    E{a.e} N{a.n}
                    {conflict && <i className="chip chip-danger">坐标冲突</i>}
                  </>
                )}
              </span>
              <span>{R.fmtWeight(a.weight)}</span>
              <span>
                <i className={`chip st-${a.status}`}>{STATUS_TEXT[a.status]}</i>
                {a.bagNo && <small className="muted"> {a.bagNo}</small>}
              </span>
              <span className="row-actions">
                {editing ? (
                  <>
                    <button
                      className="btn-sm primary-action"
                      onClick={() => {
                        const ce = Number(editCoord.e);
                        const cn = Number(editCoord.n);
                        if (Number.isFinite(ce) && Number.isFinite(cn)) {
                          dispatch({ type: "fix-coord", id: a.id, e: ce, n: cn });
                        }
                        setEditingId(null);
                      }}
                    >
                      保存
                    </button>
                    <button className="btn-sm" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    {(a.status === "registered" || conflict) && a.status !== "shipped" && !sealed && (
                      <button
                        className="btn-sm"
                        onClick={() => {
                          setEditingId(a.id);
                          setEditCoord({ e: String(a.e), n: String(a.n) });
                        }}
                      >
                        修正坐标
                      </button>
                    )}
                    {a.status === "registered" && !sealed && (
                      <button className="btn-sm" onClick={() => dispatch({ type: "toggle-shipped", id: a.id })}>
                        运出
                      </button>
                    )}
                    {a.status === "shipped" && !sealed && (
                      <button className="btn-sm" onClick={() => dispatch({ type: "toggle-shipped", id: a.id })}>
                        取消运出
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          );
        })}
        {!artifacts.length && <p className="muted empty-line">本地层暂无出土物</p>}
      </div>

      {!sealed && (
        <div className="bag-bar">
          <span>
            已选 {selCheck.count} 件 / 合计 {R.fmtWeight(selCheck.weight)}（上限 {BAG_MAX_ITEMS} 件 /{" "}
            {R.fmtWeight(BAG_MAX_WEIGHT)}）
          </span>
          {!selCheck.ok && selCheck.count > 0 && (
            <span className="warn-text">超出上限，提交后将排队，不占用袋号</span>
          )}
          <span className="bag-bar-actions">
            <button className="btn-sm" onClick={selectAllEligible}>
              全选可装袋
            </button>
            <button
              className="primary-action"
              disabled={!selectedItems.length}
              onClick={requestBag}
            >
              申请装袋
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
