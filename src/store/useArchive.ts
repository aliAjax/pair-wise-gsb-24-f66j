import { useEffect, useMemo, useReducer, useRef } from "react";
import { STATE_KEY } from "../domain/constants";
import { buildSeedState } from "../domain/seed";
import type { ArchiveState } from "../domain/types";
import { archiveReducer } from "./reducer";
import { formatBagNo, resetRemote, simulateCompetingWindow } from "./remote";
import { resyncAll, syncOutbox } from "./sync";

function initState(): ArchiveState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ArchiveState;
      if (parsed && Array.isArray(parsed.units)) return parsed;
    }
  } catch {
    /* 缓存损坏时回到示例数据 */
  }
  return buildSeedState();
}

export function useArchive() {
  const [state, dispatch] = useReducer(
    archiveReducer,
    null as unknown as ArchiveState,
    initState
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // 现场断网先记本地：每次变更都落盘
  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* 存储不可用时仅保留内存态 */
    }
  }, [state]);

  // 回连自动合并；在线且有待同步项时自动补发
  useEffect(() => {
    if (!state.online || state.simulateFailure) return;
    if (!state.outbox.some((o) => o.status !== "done")) return;
    const res = syncOutbox(stateRef.current);
    if (res.changed) dispatch({ type: "applySync", ...res });
  }, [state.online, state.outbox, state.simulateFailure]);

  const actions = useMemo(
    () => ({
      register: (
        unitId: string,
        layerId: string,
        name: string,
        e: number,
        n: number,
        weightG: number
      ) => dispatch({ type: "register", unitId, layerId, name, e, n, weightG }),
      addToBag: (artifactId: string) => dispatch({ type: "addToBag", artifactId }),
      sealBag: (bagId: string) => dispatch({ type: "sealBag", bagId }),
      bumpLayer: (layerId: string) => dispatch({ type: "bumpLayer", layerId }),
      resizeGrid: (unitId: string, gridE: number, gridN: number) =>
        dispatch({ type: "resizeGrid", unitId, gridE, gridN }),
      fixCoord: (artifactId: string, e: number, n: number) =>
        dispatch({ type: "fixCoord", artifactId, e, n }),
      transport: (artifactId: string) => dispatch({ type: "transport", artifactId }),
      appSave: (unitId: string, note: string) => dispatch({ type: "appSave", unitId, note }),
      appSubmit: (unitId: string) => dispatch({ type: "appSubmit", unitId }),
      appApprove: (unitId: string) => dispatch({ type: "appApprove", unitId }),
      setOnline: (online: boolean) => dispatch({ type: "setOnline", online }),
      toggleFailure: () => dispatch({ type: "toggleFailure" }),
      syncNow: () => {
        const res = syncOutbox(stateRef.current);
        dispatch({ type: "applySync", ...res });
      },
      resyncAll: () => dispatch({ type: "log", messages: resyncAll(stateRef.current) }),
      compete: () => {
        const s = stateRef.current;
        const pending = s.outbox.find((o) => o.status !== "done");
        const target = pending ? pending.bagNo : formatBagNo(s.seq.bag);
        dispatch({ type: "log", messages: [simulateCompetingWindow(target)] });
      },
      reset: () => {
        resetRemote();
        dispatch({ type: "reset" });
      },
    }),
    []
  );

  return { state, actions };
}

export type ArchiveActions = ReturnType<typeof useArchive>["actions"];
