import { useState } from "react";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { BagPanel } from "./components/BagPanel";
import { GridView } from "./components/GridView";
import { LayerPanel } from "./components/LayerPanel";
import { SealPanel } from "./components/SealPanel";
import { StatusChip } from "./components/StatusChip";
import { SyncPanel } from "./components/SyncPanel";
import { coordConflicts, pendingSummary } from "./domain/rules";
import { useArchive } from "./store/useArchive";
import { WINDOW_ID } from "./store/remote";
import "./styles.css";

const project = {
  id: "hxwl-10",
  port: 5110,
  title: "考古探方记录",
  subtitle: "探方 · 地层 · 出土物 · 取样袋 —— 可续作的封存依据链",
};

const RULES = [
  "出土物坐标必须落进所属探方网格，越界即冲突",
  "取样袋只装同探方同地层、已登记且未运走的出土物",
  `袋内件数与总重超上限即排队，封袋时才分配袋号，不先占号`,
  "地层换版或封存申请变更：未封袋记录失效重算，已封袋保留原依据",
  "断网先记本地，回连按袋号逐件合并，重复回传只入库一次",
  "同一袋号两窗口同时提交先到者生效，写失败只重试未完成项",
  "没有待处理袋和坐标冲突，封存申请才能通过；页面与导出同一依据",
];

function MetricCard({ label, value, index }: { label: string; value: number; index: number }) {
  const tones = ["status-ok", "status-watch", "status-danger"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={tones[index % tones.length]} />
    </article>
  );
}

export default function App() {
  const { state, actions } = useArchive();
  const [unitId, setUnitId] = useState(state.units[0].id);
  const unit = state.units.find((u) => u.id === unitId) ?? state.units[0];
  const artifacts = state.artifacts.filter((a) => a.unitId === unit.id);

  const pendingAll = state.units.reduce((sum, u) => {
    const p = pendingSummary(state, u.id);
    return sum + p.openBags.length + p.queued.length + coordConflicts(state, u.id).length;
  }, 0);

  const metrics: [string, number][] = [
    ["探方数", state.units.length],
    ["地层数", state.layers.length],
    ["出土物", state.artifacts.filter((a) => a.status !== "transported").length],
    ["待处理项", pendingAll],
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port} · {WINDOW_ID} ·{" "}
            {state.online ? "在线" : "断网（本地记录中）"}
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>封存规则</span>
          <ul className="rule-list">
            {RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map(([label, value], index) => (
          <MetricCard key={label} label={label} value={value} index={index} />
        ))}
      </section>

      <nav className="unit-tabs">
        {state.units.map((u) => (
          <button
            key={u.id}
            className={u.id === unit.id ? "tab active" : "tab"}
            onClick={() => setUnitId(u.id)}
          >
            {u.id} <StatusChip kind="unit" status={u.status} />
          </button>
        ))}
      </nav>

      <section className="workspace">
        <aside className="side-col">
          <LayerPanel key={`layer-${unit.id}`} state={state} actions={actions} unitId={unit.id} />
          <SealPanel key={`seal-${unit.id}`} state={state} actions={actions} unitId={unit.id} />
        </aside>
        <div className="main-col">
          <GridView unit={unit} artifacts={artifacts} />
          <ArtifactPanel
            key={`artifact-${unit.id}`}
            state={state}
            actions={actions}
            unitId={unit.id}
          />
        </div>
      </section>

      <section className="workspace">
        <div className="main-col">
          <BagPanel state={state} actions={actions} unitId={unit.id} />
        </div>
        <aside className="side-col">
          <SyncPanel state={state} actions={actions} />
        </aside>
      </section>
    </main>
  );
}
