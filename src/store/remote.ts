import { REMOTE_KEY } from "../domain/constants";

/**
 * 模拟远端档案库（独立 localStorage 命名空间）。
 * 本窗口的本地状态是另一份存储，断网时互不可见；
 * 另开浏览器标签页即共享同一远端，可真实演示“两个窗口同袋号”。
 */

export interface RemoteBag {
  bagNo: string;
  opId: string;
  windowId: string;
  arrivedAt: number;
}

export interface RemoteItem {
  key: string; // 幂等键：袋号::出土物编号
  bagNo: string;
  artifactId: string;
}

export interface RemoteDb {
  seq: number; // 远端权威袋号计数
  bags: Record<string, RemoteBag>;
  items: Record<string, RemoteItem>;
}

/** 窗口身份：同一标签页刷新保持不变，新标签页视为另一窗口 */
export const WINDOW_ID: string = (() => {
  try {
    const cached = sessionStorage.getItem("hxwl10.window");
    if (cached) return cached;
    const id = "窗口" + Math.random().toString(36).slice(2, 6).toUpperCase();
    sessionStorage.setItem("hxwl10.window", id);
    return id;
  } catch {
    return "窗口LOCAL";
  }
})();

export function formatBagNo(n: number): string {
  return `D-${String(n).padStart(4, "0")}`;
}

export function parseBagNo(no: string): number {
  const n = Number(no.replace(/^D-/, ""));
  return Number.isFinite(n) ? n : 0;
}

export function loadRemote(): RemoteDb {
  try {
    const raw = localStorage.getItem(REMOTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RemoteDb>;
      return { seq: parsed.seq ?? 0, bags: parsed.bags ?? {}, items: parsed.items ?? {} };
    }
  } catch {
    /* 缓存损坏时按空库处理 */
  }
  return { seq: 0, bags: {}, items: {} };
}

export function saveRemote(db: RemoteDb): void {
  localStorage.setItem(REMOTE_KEY, JSON.stringify(db));
}

export function resetRemote(): void {
  localStorage.removeItem(REMOTE_KEY);
}

/** 模拟另一窗口抢先提交同一袋号（先到者生效） */
export function simulateCompetingWindow(bagNo: string): string {
  const db = loadRemote();
  const competitor = "外业B组";
  db.bags[bagNo] = {
    bagNo,
    opId: `OP-EXT-${bagNo}`,
    windowId: competitor,
    arrivedAt: Date.now(),
  };
  const n = parseBagNo(bagNo);
  if (n > db.seq) db.seq = n;
  saveRemote(db);
  return `${competitor} 已抢先提交袋号 ${bagNo}（先到者生效，本窗口回连时将改发新号）`;
}
