import type { ArchiveState, SampleBag, SyncOp } from "../domain/types";
import { formatBagNo, loadRemote, parseBagNo, saveRemote } from "./remote";

export interface SyncOutcome {
  outbox: SyncOp[];
  bags: SampleBag[];
  minNextBagSeq: number;
  messages: string[];
  changed: boolean;
}

/**
 * 回连同步：按袋号逐件合并。
 * - 同一袋号两个窗口同时提交：远端先到者生效，本窗口改发新号；
 * - 重复回传按幂等键去重，只入库一次；
 * - 写入失败时保留未完成项，重试只补未完成项。
 */
export function syncOutbox(state: ArchiveState): SyncOutcome {
  const outbox = state.outbox.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i })) }));
  const bags = state.bags.map((b) => ({ ...b, basis: b.basis ? { ...b.basis } : null }));
  const messages: string[] = [];
  let changed = false;
  let maxNo = 0;

  if (!state.online) {
    return {
      outbox,
      bags,
      minNextBagSeq: 0,
      messages: ["当前断网：记录仅保存在本地，待回连后按袋号逐件合并"],
      changed: false,
    };
  }

  const db = loadRemote();
  let remoteChanged = false;

  for (const op of outbox) {
    if (op.status === "done") continue;
    op.attempts += 1;
    changed = true;

    // 1) 袋号冲突：先到者生效，本窗口改发远端新号
    const holder = db.bags[op.bagNo];
    if (holder && holder.opId !== op.opId) {
      db.seq += 1;
      const newNo = formatBagNo(db.seq);
      messages.push(
`袋号 ${op.bagNo} 已被 ${holder.windowId} 占用（先到者生效），本窗口改发 ${newNo}`);
      op.bagNo = newNo;
      for (const item of op.items) item.key = `${newNo}::${item.artifactId}`;
      const bag = bags.find((b) => b.id === op.bagId);
      if (bag) {
        bag.bagNo = newNo;
        if (bag.basis) bag.basis = { ...bag.basis, bagNo: newNo };
      }
      remoteChanged = true;
    }

    // 2) 登记袋号（远端计数随之推进）
    if (!db.bags[op.bagNo]) {
      db.bags[op.bagNo] = {
        bagNo: op.bagNo,
        opId: op.opId,
        windowId: op.windowId,
        arrivedAt: Date.now(),
      };
      const n = parseBagNo(op.bagNo);
      if (n > db.seq) db.seq = n;
      messages.push(`远端登记袋号 ${op.bagNo}（${op.windowId}）`);
      remoteChanged = true;
    }

    // 3) 逐件合并；模拟故障时中断，只留未完成项待重试
    let writes = 0;
    for (const item of op.items) {
      if (item.done) continue;
      if (state.simulateFailure && writes >= 1) {
        const left = op.items.filter((i) => !i.done).length;
        messages.push(`写入中断（模拟故障）：${op.bagNo} 余 ${left} 件未完成，重试只补未完成项`);
        break;
      }
      if (db.items[item.key]) {
        messages.push(`重复回传 ${item.key}，已去重`);
      } else {
        db.items[item.key] = { key: item.key, bagNo: op.bagNo, artifactId: item.artifactId };
        writes += 1;
        remoteChanged = true;
        messages.push(`入库 ${item.key}`);
      }
      item.done = true;
    }

    if (op.items.every((i) => i.done)) {
      op.status = "done";
      messages.push(`袋 ${op.bagNo} 合并完成（${op.items.length} 件）`);
    }
    maxNo = Math.max(maxNo, parseBagNo(op.bagNo));
  }

  if (remoteChanged) saveRemote(db);
  if (!changed) messages.push("无待同步项");

  return {
    outbox,
    bags,
    minNextBagSeq: Math.max(maxNo, db.seq) + 1,
    messages,
    changed,
  };
}

/** 重复回传：对全部回传记录再发一遍，远端按幂等键去重 */
export function resyncAll(state: ArchiveState): string[] {
  const db = loadRemote();
  let added = 0;
  let dup = 0;
  for (const op of state.outbox) {
    for (const item of op.items) {
      if (db.items[item.key]) {
        dup += 1;
      } else {
        db.items[item.key] = { key: item.key, bagNo: op.bagNo, artifactId: item.artifactId };
        added += 1;
      }
    }
  }
  saveRemote(db);
  const total = added + dup;
  if (total === 0) return ["重复回传：本地暂无回传记录"];
  return [
    `重复回传 ${total} 件：新增 ${added} 件、去重 ${dup} 件（重复只入库一次），远端现共 ${Object.keys(db.items).length} 件`,
  ];
}
