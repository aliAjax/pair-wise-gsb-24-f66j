import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Artifact,
  BAG_MAX_ITEMS,
  BAG_MAX_WEIGHT,
  OutboxOp,
  QueueRequest,
  SampleBag,
} from "./types";
import { SCHEMA_VERSION, seedState } from "./seed";
import * as R from "./rules";
import { commitOp, resetRemote } from "./remote";

// ---------- 本地持久化（每个浏览器窗口一份本地库，远端库跨窗口共享） ----------

function getTabId(): string {
  let id = sessionStorage.getItem("hxwl10-tab");
  if (!id) {
    id = Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem("hxwl10-tab", id);
  }
  return id;
}

const TAB_ID = getTabId();
export const LOCAL_KEY = `hxwl10-local-${TAB_ID}`;

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.schema === SCHEMA_VERSION) return s;
    }
  } catch {
    // 落回种子数据
  }
  return seedState(TAB_ID);
}

let uidCounter = 0;
function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

// ---------- Action ----------

export type Action =
  | { type: "select-unit"; unitId: string }
  | { type: "select-layer"; unitId: string; layerId: string }
  | { type: "set-filter"; filter: string | null }
  | { type: "register-artifact"; input: { unitId: string; layerId: string; name: string; weight: number; e: number; n: number } }
  | { type: "fix-coord"; id: string; e: number; n: number }
  | { type: "toggle-shipped"; id: string }
  | { type: "request-bag"; unitId: string; layerId: string; itemIds: string[] }
  | { type: "settle-request"; requestId: string }
  | { type: "cancel-request"; requestId: string }
  | { type: "seal-bag"; bagId: string }
  | { type: "bump-layer"; layerId: string }
  | { type: "create-application"; unitId: string; note: string }
  | { type: "change-application"; unitId: string; note: string }
  | { type: "approve-application"; unitId: string }
  | { type: "reject-application"; unitId: string }
  | { type: "set-online"; online: boolean }
  | { type: "set-fault"; on: boolean }
  | { type: "op-done"; id: string; note?: string }
  | { type: "op-failed"; id: string; error: string }
  | { type: "bag-conflict"; bagNo: string; note: string }
  | { type: "log"; text: string }
  | { type: "reset-all" };

// ---------- 内部助手 ----------

function say(state: AppState, text: string): AppState {
  return { ...state, log: [{ time: Date.now(), text }, ...state.log].slice(0, 80) };
}

function pushOp(state: AppState, kind: OutboxOp["kind"], label: string, payload: Record<string, unknown>): OutboxOp {
  return { id: uid("op"), kind, label, payload, status: "pending", attempts: 0, createdAt: Date.now() };
}

/** 装袋成功才分配袋号（排队不占号） */
function createBag(state: AppState, unitId: string, layerId: string, items: Artifact[]): { state: AppState; bag: SampleBag } {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`地层不存在：${layerId}`);
  const key = R.scopeKey(unitId, layerId);
  const seq = (state.bagSeq[key] ?? 0) + 1;
  const bagNo = R.makeBagNo(unitId, layer.code, seq);
  const basis = R.currentBasis(state, unitId, layerId);
  const bag: SampleBag = {
    id: uid("bag"),
    bagNo,
    unitId,
    layerId,
    basis,
    items: items.map((i) => ({ id: i.id, name: i.name, weight: i.weight })),
    totalWeight: items.reduce((s, i) => s + i.weight, 0),
    status: "open",
    origin: state.sessionId,
    createdAt: Date.now(),
  };
  const ids = new Set(items.map((i) => i.id));
  const artifacts = state.artifacts.map((a) =>
    ids.has(a.id) ? { ...a, status: "bagged" as const, bagNo } : a
  );
  const op = pushOp(state, "bag-create", `装袋 ${bagNo}`, {
    localId: bag.id,
    bagNo,
    unitId,
    layerId,
    basis,
    items: bag.items,
    totalWeight: bag.totalWeight,
  });
  return {
    state: {
      ...state,
      bags: [bag, ...state.bags],
      artifacts,
      bagSeq: { ...state.bagSeq, [key]: seq },
      outbox: [...state.outbox, op],
    },
    bag,
  };
}

/**
 * 未封袋记录失效重算：作废未封袋（可选是否含已封袋），出土物回到已登记，
 * 并自动生成“失效重算”排队单等待重新装袋。已封袋默认保留原依据。
 */
function invalidateBags(
  state: AppState,
  pred: (b: SampleBag) => boolean,
  reason: string,
  includeSealed: boolean
): AppState {
  const targets = state.bags.filter(
    (b) => pred(b) && (b.status === "open" || (includeSealed && b.status === "sealed"))
  );
  if (!targets.length) return state;
  const now = Date.now();
  const voidNos = new Set(targets.map((b) => b.bagNo));
  const bags = state.bags.map((b) =>
    voidNos.has(b.bagNo) ? { ...b, status: "void" as const, voidReason: reason } : b
  );
  const artifacts = state.artifacts.map((a) =>
    a.bagNo && voidNos.has(a.bagNo) && (a.status === "bagged" || a.status === "sealed")
      ? { ...a, status: "registered" as const, bagNo: undefined }
      : a
  );
  // 按 探方+地层 归组生成重算排队单
  const groups = new Map<string, { unitId: string; layerId: string; itemIds: string[] }>();
  for (const b of targets) {
    const key = R.scopeKey(b.unitId, b.layerId);
    const g = groups.get(key) ?? { unitId: b.unitId, layerId: b.layerId, itemIds: [] };
    g.itemIds.push(...b.items.map((i) => i.id));
    groups.set(key, g);
  }
  const requests: QueueRequest[] = [...groups.values()]
    .filter((g) => g.itemIds.length)
    .map((g) => ({
      id: uid("qr"),
      unitId: g.unitId,
      layerId: g.layerId,
      itemIds: g.itemIds,
      reason: "失效重算" as const,
      status: "queued" as const,
      note: reason,
      createdAt: now,
    }));
  const voidOps = targets.map((b) =>
    pushOp(state, "bag-void", `作废 ${b.bagNo}`, { bagNo: b.bagNo, reason })
  );
  return {
    ...state,
    bags,
    artifacts,
    queue: [...requests, ...state.queue],
    outbox: [...state.outbox, ...voidOps],
  };
}

// ---------- Reducer ----------

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "select-unit":
      return { ...state, selectedUnitId: action.unitId };
    case "select-layer":
      return {
        ...state,
        selectedLayerByUnit: { ...state.selectedLayerByUnit, [action.unitId]: action.layerId },
      };
    case "set-filter":
      return { ...state, kindFilter: action.filter };

    case "register-artifact": {
      const unit = state.units.find((u) => u.id === action.input.unitId);
      if (!unit || unit.status === "sealed") return say(state, "探方已封存，不能再登记出土物");
      const { unitId, layerId, name, weight, e, n } = action.input;
      const a: Artifact = {
        id: uid("A"),
        unitId,
        layerId,
        name,
        weight,
        e,
        n,
        status: "registered",
        registeredAt: Date.now(),
      };
      const op = pushOp(state, "artifact-register", `登记 ${name}`, {
        id: a.id,
        unitId,
        layerId,
        name,
        weight,
        e,
        n,
      });
      const conflict = R.coordConflict(a, unit);
      return say(
        { ...state, artifacts: [...state.artifacts, a], outbox: [...state.outbox, op] },
        conflict
          ? `已登记 ${name}（E${e} N${n}），但坐标超出 ${unitId} 网格 ${unit.east}×${unit.north}m，记为坐标冲突，需修正`
          : `已登记 ${name}（E${e} N${n}，${weight}g）`
      );
    }

    case "fix-coord": {
      const a = state.artifacts.find((x) => x.id === action.id);
      if (!a) return state;
      const unit = R.findUnit(state, a.unitId);
      const artifacts = state.artifacts.map((x) =>
        x.id === action.id ? { ...x, e: action.e, n: action.n } : x
      );
      const op = pushOp(state, "artifact-update", `修正坐标 ${a.name}`, {
        id: a.id,
        e: action.e,
        n: action.n,
      });
      const stillBad = R.coordConflict({ e: action.e, n: action.n }, unit);
      return say(
        { ...state, artifacts, outbox: [...state.outbox, op] },
        stillBad
          ? `${a.name} 坐标改为 E${action.e} N${action.n}，仍超出网格，冲突未解除`
          : `${a.name} 坐标修正为 E${action.e} N${action.n}，冲突解除`
      );
    }

    case "toggle-shipped": {
      const a = state.artifacts.find((x) => x.id === action.id);
      if (!a) return state;
      if (a.status === "registered") {
        const artifacts = state.artifacts.map((x) =>
          x.id === a.id ? { ...x, status: "shipped" as const } : x
        );
        return say({ ...state, artifacts }, `${a.name} 已标记运走，不再参与装袋`);
      }
      if (a.status === "shipped") {
        const artifacts = state.artifacts.map((x) =>
          x.id === a.id ? { ...x, status: "registered" as const } : x
        );
        return say({ ...state, artifacts }, `${a.name} 取消运走标记，恢复为已登记`);
      }
      return say(state, `${a.name} 当前状态不能标记运走`);
    }

    case "request-bag": {
      const unit = R.findUnit(state, action.unitId);
      if (unit.status === "sealed") return say(state, "探方已封存，不能再装袋");
      const queued = R.queuedItemIds(state);
      // 只接受：同探方同地层、已登记、未运走、未在其他排队单中的出土物
      const items = state.artifacts.filter(
        (a) =>
          action.itemIds.includes(a.id) &&
          a.status === "registered" &&
          a.unitId === action.unitId &&
          a.layerId === action.layerId &&
          !queued.has(a.id)
      );
      if (!items.length) {
        return say(state, "没有可装袋的出土物：须为同探方同地层、已登记且未运走");
      }
      const check = R.checkBagLimits(items);
      if (!check.ok) {
        const req: QueueRequest = {
          id: uid("qr"),
          unitId: action.unitId,
          layerId: action.layerId,
          itemIds: items.map((i) => i.id),
          reason: "超限排队",
          status: "queued",
          note: `${check.count}件 / ${check.weight}g 超出上限（${BAG_MAX_ITEMS}件 / ${BAG_MAX_WEIGHT}g）`,
          createdAt: Date.now(),
        };
        return say(
          { ...state, queue: [req, ...state.queue] },
          `装袋请求 ${check.count}件/${check.weight}g 超出上限，已排队等待结算，未占用袋号`
        );
      }
      const { state: s2, bag } = createBag(state, action.unitId, action.layerId, items);
      return say(s2, `已装袋 ${bag.bagNo}（${bag.items.length}件，${bag.totalWeight}g），依据 ${R.basisText(bag.basis)}`);
    }

    case "settle-request": {
      const req = state.queue.find((q) => q.id === action.requestId && q.status === "queued");
      if (!req) return state;
      const unit = R.findUnit(state, req.unitId);
      if (unit.status === "sealed") return say(state, "探方已封存，队列不再结算");
      const items = req.itemIds
        .map((id) => state.artifacts.find((a) => a.id === id))
        .filter((a): a is Artifact => !!a && a.status === "registered" && a.layerId === req.layerId);
      if (!items.length) {
        const queue = state.queue.map((q) =>
          q.id === req.id ? { ...q, status: "done" as const, note: "无有效出土物，已结案" } : q
        );
        return say({ ...state, queue }, "队列单内出土物均已不可用，已结案");
      }
      const { groups, rest } = R.packIntoBags(items);
      let s = state;
      const created: string[] = [];
      for (const g of groups) {
        const r = createBag(s, req.unitId, req.layerId, g);
        s = r.state;
        created.push(`${r.bag.bagNo}（${g.length}件）`);
      }
      const queue = s.queue.map((q) =>
        q.id === req.id
          ? {
              ...q,
              status: rest.length ? ("queued" as const) : ("done" as const),
              itemIds: rest.map((i) => i.id),
              note: rest.length ? "单件超过袋重上限，无法装袋" : undefined,
            }
          : q
      );
      s = { ...s, queue };
      return say(
        s,
        created.length
          ? `队列结算完成：新装 ${created.join("、")}${rest.length ? `；${rest.length} 件单件超重继续排队` : ""}`
          : "队列结算：没有可装袋的出土物"
      );
    }

    case "cancel-request": {
      const queue = state.queue.map((q) =>
        q.id === action.requestId && q.status === "queued" ? { ...q, status: "cancelled" as const } : q
      );
      return say({ ...state, queue }, "排队单已取消，出土物回到可装袋状态");
    }

    case "seal-bag": {
      const bag = state.bags.find((b) => b.id === action.bagId);
      if (!bag || bag.status !== "open") return state;
      const basis = R.currentBasis(state, bag.unitId, bag.layerId);
      if (!R.basisEq(bag.basis, basis)) {
        return say(state, `袋 ${bag.bagNo} 依据已过期，请先重算再封袋`);
      }
      const sealedAt = Date.now();
      const bags = state.bags.map((b) =>
        b.id === bag.id ? { ...b, status: "sealed" as const, sealedAt } : b
      );
      const ids = new Set(bag.items.map((i) => i.id));
      const artifacts = state.artifacts.map((a) =>
        ids.has(a.id) ? { ...a, status: "sealed" as const } : a
      );
      const op = pushOp(state, "bag-seal", `封袋 ${bag.bagNo}`, { bagNo: bag.bagNo, sealedAt, basis });
      return say(
        { ...state, bags, artifacts, outbox: [...state.outbox, op] },
        `袋 ${bag.bagNo} 已封，依据 ${R.basisText(basis)} 固化保留`
      );
    }

    case "bump-layer": {
      const layer = state.layers.find((l) => l.id === action.layerId);
      if (!layer) return state;
      const unit = R.findUnit(state, layer.unitId);
      if (unit.status === "sealed") return say(state, "探方已封存，地层不能换版");
      const layers = state.layers.map((l) =>
        l.id === layer.id ? { ...l, version: l.version + 1 } : l
      );
      let s: AppState = { ...state, layers };
      s = invalidateBags(
        s,
        (b) => b.layerId === layer.id,
        `地层换版 v${layer.version}→v${layer.version + 1}`,
        false
      );
      return say(
        s,
        `地层 ${layer.name} 已换版至 v${layer.version + 1}：未封袋记录失效重算，已封袋保留原依据`
      );
    }

    case "create-application": {
      if (state.applications.some((a) => a.unitId === action.unitId)) return state;
      const app = {
        unitId: action.unitId,
        revision: 1,
        note: action.note,
        status: "draft" as const,
        updatedAt: Date.now(),
      };
      let s: AppState = { ...state, applications: [...state.applications, app] };
      // 申请建立即依据变化：r0 依据下的未封袋失效重算
      s = invalidateBags(s, (b) => b.unitId === action.unitId, "封存申请建立（r1）", false);
      return say(s, `探方 ${action.unitId} 封存申请已建立（r1），未封袋记录按新依据重算`);
    }

    case "change-application": {
      const app = state.applications.find((a) => a.unitId === action.unitId);
      if (!app) return state;
      const unit = R.findUnit(state, action.unitId);
      if (unit.status === "sealed") return say(state, "探方已封存，申请不能变更");
      const applications = state.applications.map((a) =>
        a.unitId === action.unitId
          ? { ...a, revision: a.revision + 1, note: action.note, status: "draft" as const, updatedAt: Date.now() }
          : a
      );
      let s: AppState = { ...state, applications };
      s = invalidateBags(
        s,
        (b) => b.unitId === action.unitId,
        `封存申请变更（r${app.revision + 1}）`,
        false
      );
      return say(
        s,
        `封存申请已变更至 r${app.revision + 1}：未封袋记录失效重算，已封袋保留原依据`
      );
    }

    case "approve-application": {
      const app = state.applications.find((a) => a.unitId === action.unitId);
      if (!app || app.status === "approved") return state;
      const blk = R.sealBlockers(state, action.unitId);
      if (!R.canApprove(blk)) {
        return say(
          state,
          `封存申请未通过：未封袋 ${blk.openBags.length} 个、排队单 ${blk.queuedRequests.length} 张、坐标冲突 ${blk.conflicts.length} 件，须先清零`
        );
      }
      const now = Date.now();
      const applications = state.applications.map((a) =>
        a.unitId === action.unitId ? { ...a, status: "approved" as const, decidedAt: now } : a
      );
      const units = state.units.map((u) =>
        u.id === action.unitId ? { ...u, status: "sealed" as const } : u
      );
      return say({ ...state, applications, units }, `探方 ${action.unitId} 封存申请通过（依据 r${app.revision}），探方封存`);
    }

    case "reject-application": {
      const applications = state.applications.map((a) =>
        a.unitId === action.unitId && a.status === "draft"
          ? { ...a, status: "rejected" as const, decidedAt: Date.now() }
          : a
      );
      return say({ ...state, applications }, `探方 ${action.unitId} 封存申请已驳回`);
    }

    case "set-online":
      return say(
        { ...state, online: action.online },
        action.online ? "已回连，开始按袋号逐件合并回传" : "已断网，操作先记本地，回连后再合并"
      );

    case "set-fault":
      return { ...state, faultSealApi: action.on };

    case "op-done": {
      const outbox = state.outbox.map((o) =>
        o.id === action.id ? { ...o, status: "done" as const, attempts: o.attempts + 1, error: undefined } : o
      );
      return action.note ? say({ ...state, outbox }, action.note) : { ...state, outbox };
    }

    case "op-failed": {
      const outbox = state.outbox.map((o) =>
        o.id === action.id ? { ...o, status: "failed" as const, attempts: o.attempts + 1, error: action.error } : o
      );
      return say({ ...state, outbox }, `写入失败：${action.error}（仅该项待重试）`);
    }

    case "bag-conflict": {
      const bag = state.bags.find((b) => b.bagNo === action.bagNo && b.status !== "void");
      if (!bag) return say(state, action.note);
      // 同一袋号他窗口先到：本袋作废（含已封袋），出土物释放并重算
      const s = invalidateBags(state, (b) => b.bagNo === action.bagNo, "袋号冲突，他窗口先到", true);
      return say(s, `${action.note}；本袋作废，出土物已释放进入重算队列`);
    }

    case "log":
      return say(state, action.text);

    case "reset-all":
      return seedState(state.sessionId);

    default:
      return state;
  }
}

// ---------- Provider + 同步引擎 ----------

interface StoreCtx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  syncNow: () => Promise<void>;
  syncing: boolean;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);
  const [syncing, setSyncing] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  }, [state]);

  const syncNow = useCallback(async () => {
    const s = stateRef.current;
    if (!s.online || syncingRef.current) return;
    const pending = s.outbox.filter((o) => o.status !== "done");
    if (!pending.length) {
      dispatch({ type: "log", text: "同步检查：没有待处理项，已完成项不重复回传" });
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    dispatch({ type: "log", text: `回连同步开始：${pending.length} 条待处理，逐条按袋号合并` });
    for (const op of pending) {
      try {
        const res = await commitOp(op, s.sessionId, stateRef.current.faultSealApi);
        if (res.conflict) {
          dispatch({ type: "bag-conflict", bagNo: String(op.payload.bagNo ?? ""), note: res.note });
        }
        dispatch({ type: "op-done", id: op.id, note: res.note });
      } catch (e) {
        dispatch({ type: "op-failed", id: op.id, error: e instanceof Error ? e.message : String(e) });
        break; // 失败后停止，剩余项保持待处理，只重试未完成项
      }
    }
    syncingRef.current = false;
    setSyncing(false);
    dispatch({ type: "log", text: "本轮同步结束" });
  }, []);

  // 回连自动同步
  const wasOffline = useRef(!state.online);
  useEffect(() => {
    if (state.online && wasOffline.current) void syncNow();
    wasOffline.current = !state.online;
  }, [state.online, syncNow]);

  // 启动时如有遗留待处理项，自动补传
  useEffect(() => {
    void syncNow();
  }, [syncNow]);

  const value = useMemo(() => ({ state, dispatch, syncNow, syncing }), [state, syncNow, syncing]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore 必须在 StoreProvider 内使用");
  return v;
}

export function resetAllStorage(): void {
  resetRemote();
  localStorage.removeItem(LOCAL_KEY);
}
