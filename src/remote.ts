import type { BagBasis, BagItemSnapshot, OutboxOp } from "./types";

/**
 * 模拟远端库房档案库。
 * 用 localStorage 共享存储，因此另开一个浏览器窗口即为“第二个提交窗口”；
 * 通过 Web Locks（不支持时退化为同步写）保证跨窗口互斥，先到者生效。
 */

export interface RemoteBag {
  bagNo: string;
  localId: string;
  origin: string;
  unitId: string;
  layerId: string;
  basis: BagBasis;
  items: BagItemSnapshot[];
  totalWeight: number;
  status: "open" | "sealed" | "void";
  sealedAt?: number;
  voidReason?: string;
}

export interface RemoteArtifact {
  id: string;
  unitId: string;
  layerId: string;
  name: string;
  weight: number;
  e: number;
  n: number;
  origin: string;
}

export interface RemoteState {
  appliedOps: string[]; // 已入库操作 id：重复回传只入库一次
  bags: Record<string, RemoteBag>;
  artifacts: Record<string, RemoteArtifact>;
}

const REMOTE_KEY = "hxwl10-remote-v1";

export function loadRemote(): RemoteState {
  try {
    const raw = localStorage.getItem(REMOTE_KEY);
    if (raw) return JSON.parse(raw) as RemoteState;
  } catch {
    // 损坏则重建
  }
  return { appliedOps: [], bags: {}, artifacts: {} };
}

function saveRemote(s: RemoteState): void {
  localStorage.setItem(REMOTE_KEY, JSON.stringify(s));
}

export function resetRemote(): void {
  localStorage.removeItem(REMOTE_KEY);
}

export interface CommitOutcome {
  conflict?: boolean; // 袋号被其他窗口先占用
  skipped?: boolean; // 重复回传，已跳过
  note: string;
}

interface LockLike {
  request<T>(name: string, cb: () => T | Promise<T>): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function commitOp(op: OutboxOp, origin: string, faultSealApi: boolean): Promise<CommitOutcome> {
  const nav = navigator as Navigator & { locks?: LockLike };
  if (nav.locks?.request) {
    return nav.locks.request("hxwl10-remote-lock", () => commitInner(op, origin, faultSealApi));
  }
  return commitInner(op, origin, faultSealApi);
}

async function commitInner(op: OutboxOp, origin: string, faultSealApi: boolean): Promise<CommitOutcome> {
  await sleep(60); // 模拟网络往返
  const remote = loadRemote();

  // 幂等：同一操作重复回传只入库一次
  if (remote.appliedOps.includes(op.id)) {
    return { skipped: true, note: `${op.label}：重复回传，已跳过` };
  }

  let note = "";
  switch (op.kind) {
    case "artifact-register": {
      const a = op.payload as unknown as RemoteArtifact;
      if (remote.artifacts[a.id]) {
        note = `出土物 ${a.name} 远端已存在，跳过`;
      } else {
        remote.artifacts[a.id] = { ...a, origin };
        note = `出土物 ${a.name} 入库`;
      }
      break;
    }
    case "artifact-update": {
      const p = op.payload as { id: string; e: number; n: number };
      const ra = remote.artifacts[p.id];
      if (ra) {
        ra.e = p.e;
        ra.n = p.n;
        note = `出土物坐标已更新（E${p.e} N${p.n}）`;
      } else {
        note = "远端无此出土物，坐标更新略过";
      }
      break;
    }
    case "bag-create": {
      const p = op.payload as unknown as {
        localId: string;
        bagNo: string;
        unitId: string;
        layerId: string;
        basis: BagBasis;
        items: BagItemSnapshot[];
        totalWeight: number;
      };
      const exist = remote.bags[p.bagNo];
      if (exist && exist.localId !== p.localId) {
        // 同一袋号两个窗口同时提交：先到者生效，本袋作废（操作本身视为已处理）
        remote.appliedOps.push(op.id);
        saveRemote(remote);
        return {
          conflict: true,
          note: `袋号 ${p.bagNo} 已被窗口 #${exist.origin} 先占用，本窗口提交作废`,
        };
      }
      if (exist) {
        // 同一袋号回连：按袋号逐件合并，已入库的件跳过
        const have = new Set(exist.items.map((i) => i.id));
        let added = 0;
        for (const it of p.items) {
          if (!have.has(it.id)) {
            exist.items.push(it);
            added += 1;
          }
        }
        exist.totalWeight = exist.items.reduce((s, i) => s + i.weight, 0);
        note = `袋 ${p.bagNo} 逐件合并：新增 ${added} 件，跳过 ${p.items.length - added} 件`;
      } else {
        remote.bags[p.bagNo] = {
          bagNo: p.bagNo,
          localId: p.localId,
          origin,
          unitId: p.unitId,
          layerId: p.layerId,
          basis: p.basis,
          items: [...p.items],
          totalWeight: p.totalWeight,
          status: "open",
        };
        note = `袋 ${p.bagNo} 入库（${p.items.length} 件，${p.totalWeight}g）`;
      }
      break;
    }
    case "bag-seal": {
      if (faultSealApi) {
        throw new Error("封口登记接口写入失败（模拟故障）");
      }
      const p = op.payload as { bagNo: string; sealedAt: number; basis: BagBasis };
      const b = remote.bags[p.bagNo];
      if (!b) throw new Error(`远端不存在袋 ${p.bagNo}，封口失败`);
      b.status = "sealed";
      b.sealedAt = p.sealedAt;
      b.basis = p.basis;
      note = `袋 ${p.bagNo} 封口入库`;
      break;
    }
    case "bag-void": {
      const p = op.payload as { bagNo: string; reason: string };
      const b = remote.bags[p.bagNo];
      if (b) {
        b.status = "void";
        b.voidReason = p.reason;
      }
      note = `袋 ${p.bagNo} 作废登记`;
      break;
    }
  }

  remote.appliedOps.push(op.id);
  saveRemote(remote);
  return { note };
}
