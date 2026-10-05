import type { Artifact, ExcavationUnit } from "../domain/types";

/** 探方网格落位图：每个格子显示该坐标的出土物状态点 */
export function GridView({
  unit,
  artifacts,
}: {
  unit: ExcavationUnit;
  artifacts: Artifact[];
}) {
  const visible = artifacts.filter((a) => a.status !== "transported");
  const cellOf = (e: number, n: number) =>
    visible.filter((a) => a.coordE === e && a.coordN === n);
  const cols = Array.from({ length: unit.gridE }, (_, i) => i + 1);
  const rows = Array.from({ length: unit.gridN }, (_, i) => unit.gridN - i);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>
            探方网格 · E1–{unit.gridE} / N1–{unit.gridN}
          </p>
          <h2>{unit.id} 坐标落位</h2>
        </div>
        <div className="legend">
          <span>
            <i className="dot dot-registered" />
            已登记
          </span>
          <span>
            <i className="dot dot-queued" />
            排队
          </span>
          <span>
            <i className="dot dot-bagged" />
            已装袋
          </span>
          <span>
            <i className="dot dot-sealed" />
            已封袋
          </span>
        </div>
      </div>
      <div className="grid-board">
        {rows.map((n) => (
          <div className="grid-row" key={n}>
            <span className="grid-axis">N{n}</span>
            {cols.map((e) => {
              const cell = cellOf(e, n);
              return (
                <div
                  className="grid-cell"
                  key={e}
                  title={
                    cell.length
                      ? cell.map((a) => `${a.id} ${a.name}`).join("\n")
                      : `E${e}N${n} 空`
                  }
                >
                  {cell.map((a) => (
                    <i key={a.id} className={`dot dot-${a.status}`} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        <div className="grid-row">
          <span className="grid-axis" />
          {cols.map((e) => (
            <span className="grid-axis" key={e}>
              E{e}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
