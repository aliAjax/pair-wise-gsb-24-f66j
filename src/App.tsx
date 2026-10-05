import "./styles.css";
import { StoreProvider, useStore } from "./store";
import * as R from "./rules";
import SyncCard from "./components/SyncCard";
import UnitLayerPanel from "./components/UnitLayerPanel";
import ArtifactPanel from "./components/ArtifactPanel";
import BagPanel from "./components/BagPanel";
import QueuePanel from "./components/QueuePanel";
import SealPanel from "./components/SealPanel";
import LogPanel from "./components/LogPanel";

function MetricCard({ label, value, index }: { label: string; value: number; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function Shell() {
  const { state } = useStore();
  const pendingBags =
    state.bags.filter((b) => b.status === "open").length +
    state.queue.filter((q) => q.status === "queued").length;
  const conflicts = state.units.reduce(
    (n, u) =>
      n +
      state.artifacts.filter(
        (a) => a.unitId === u.id && a.status !== "shipped" && a.status !== "sealed" && R.coordConflict(a, u)
      ).length,
    0
  );

  const metrics: [string, number][] = [
    ["探方数", state.units.length],
    ["地层数", state.layers.length],
    ["出土物", state.artifacts.length],
    ["待处理", pendingBags + conflicts],
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · port 5110 · 窗口 #{state.sessionId}</p>
          <h1>考古探方记录</h1>
          <p className="subtitle">
            遗址探方、地层关系与出土物坐标档案：坐标落格校验、超限排队不占袋号、
            换版失效重算、断网本地记录回连逐件合并，封存申请与导出共用同一依据。
          </p>
        </div>
        <SyncCard />
      </section>

      <section className="metrics-grid">
        {metrics.map(([label, value], i) => (
          <MetricCard key={label} label={label} value={value} index={i} />
        ))}
      </section>

      <section className="workspace">
        <UnitLayerPanel />
        <ArtifactPanel />
      </section>

      <section className="workspace-bags">
        <BagPanel />
        <div className="side-stack">
          <QueuePanel />
          <SealPanel />
        </div>
      </section>

      <LogPanel />
    </main>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
