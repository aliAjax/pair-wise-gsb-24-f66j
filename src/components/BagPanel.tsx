import { BAG_MAX_ITEMS, BAG_MAX_WEIGHT_G } from "../domain/constants";
import { layerName } from "../domain/rules";
import type { ArchiveState } from "../domain/types";
import type { ArchiveActions } from "../store/useArchive";
import { StatusChip } from "./StatusChip";

/** 取样袋：待封袋（容量与排队）、已封袋（依据快照 + 回传进度）、已失效 */
export function BagPanel({
  state,
  actions,
  unitId,
}: {
  state: ArchiveState;
  actions: ArchiveActions;
  unitId: string;
}) {
  const bags = state.bags.filter((b) => b.unitId === unitId);
  const openBags = bags.filter((b) => b.status === "open");
  const sealedBags = bags
    .filter((b) => b.status === "sealed")
    .sort((a, b) => ((a.bagNo ?? "") < (b.bagNo ?? "") ? -1 : 1));
  const invalidated = bags.filter((b) => b.status === "invalidated");
  const queued = state.artifacts.filter(
    (a) => a.unitId === unitId && a.status === "queued"
  );
  const artifactById = new Map(state.artifacts.map((a) => [a.id, a]));
  const opByBagId = new Map(state.outbox.map((o) => [o.bagId, o]));
  const unit = state.units.find((u) => u.id === unitId)!;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>取样袋 · 上限 {BAG_MAX_ITEMS} 件 / {BAG_MAX_WEIGHT_G}g</p>
          <h2>装袋与封袋</h2>
        </div>
        <span className="muted">袋号在封袋时分配，排队不占号</span>
      </div>

      {openBags.length === 0 && sealedBags.length === 0 && invalidated.length === 0 && (
        <p className="muted">暂无取样袋：在出土物列表点「装袋」后自动开袋。</p>
      )}

      {openBags.map((bag) => (
        <article className="bag-card" key={bag.id}>
          <div className="bag-head">
            <strong>
              {bag.id} · {layerName(state, bag.layerId)} v{bag.layerVersion} · 申请 v
              {bag.appVersion}
            </strong>
            <span className="chip chip-open">袋号待分配</span>
          </div>
          <div className="capacity">
            <span>
              件数 {bag.itemIds.length}/{BAG_MAX_ITEMS}
            </span>
            <div className="bar">
              <i style={{ width: `${(bag.itemIds.length / BAG_MAX_ITEMS) * 100}%` }} />
            </div>
            <span>
              总重 {bag.totalWeightG}/{BAG_MAX_WEIGHT_G}g
            </span>
            <div className="bar">
              <i
                style={{
                  width: `${Math.min(100, (bag.totalWeightG / BAG_MAX_WEIGHT_G) * 100)}%`,
                }}
              />
            </div>
          </div>
          <div className="chips">
            {bag.itemIds.map((id) => {
              const a = artifactById.get(id);
              return (
                <span key={id}>
                  {id} {a?.name} {a?.weightG}g
                </span>
              );
            })}
          </div>
          <button
            className="primary-action"
            disabled={unit.status === "sealed"}
            onClick={() => actions.sealBag(bag.id)}
          >
            封袋并分配袋号
          </button>
        </article>
      ))}

      {queued.length > 0 && (
        <div className="queue-strip">
          排队中（未占袋号）：
          {queued.map((a) => `${a.id} ${a.name}`).join("、")}
          <span className="muted">　封袋后自动回填新袋</span>
        </div>
      )}

      {sealedBags.map((bag) => {
        const op = opByBagId.get(bag.id);
        const done = op ? op.items.filter((i) => i.done).length : 0;
        return (
          <article className="bag-card sealed" key={bag.id}>
            <div className="bag-head">
              <strong>{bag.bagNo}</strong>
              <StatusChip kind="bag" status="sealed" />
            </div>
            <p className="muted">
              依据：{layerName(state, bag.basis!.layerId)} v{bag.basis!.layerVersion} · 申请
              v{bag.basis!.appVersion} · {bag.basis!.itemCount} 件 / {bag.basis!.totalWeightG}g
              {op
                ? op.status === "done"
                  ? ` · 已入库 ${done}/${op.items.length}`
                  : ` · 待回传 ${done}/${op.items.length}`
                : ""}
            </p>
            <div className="chips">
              {bag.basis!.itemIds.map((id) => {
                const a = artifactById.get(id);
                return (
                  <span key={id}>
                    {id} {a?.name}
                  </span>
                );
              })}
            </div>
          </article>
        );
      })}

      {invalidated.length > 0 && (
        <div className="invalid-list">
          <span className="muted">已失效（依据作废，已按新版本重算）：</span>
          {invalidated.map((bag) => (
            <span className="chip chip-invalidated" key={bag.id}>
              {bag.id} · {layerName(state, bag.layerId)} v{bag.layerVersion} ·{" "}
              {bag.itemIds.length} 件
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
