import type { SessionSummary, WorkspaceView } from "./protocol";

/** 侧栏置顶数据持久化 Key。 */
const PINNED_STORAGE_KEY = "qingwu.native.pinned";

/** 项目内会话默认展示上限；「展开显示」每次多展示一批（同数），全部展示后变「收起」。官方 dsh 上限为 5。 */
export const WORKSPACE_SESSION_PREVIEW_LIMIT = 6;

export interface PinnedData {
  workspaces: string[];
  sessions: string[];
}

export function loadPinnedData(): PinnedData {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        workspaces: Array.isArray(parsed?.workspaces) ? parsed.workspaces : [],
        sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      };
    }
  } catch {}
  return { workspaces: [], sessions: [] };
}

export function savePinnedData(data: PinnedData) {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

/**
 * 合并一条工作区 upsert，顺序保持不动：已在列表里的就地替换（会话归属、标题变化
 * 不改变它在侧栏的位置），新工作区插到最前——与宿主「新建工作区前插」的落点一致。
 */
export function upsertWorkspace(
  prev: WorkspaceView[],
  workspace: WorkspaceView,
): WorkspaceView[] {
  const index = prev.findIndex((w) => w.workspaceId === workspace.workspaceId);
  if (index < 0) return [workspace, ...prev];
  const next = [...prev];
  next[index] = workspace;
  return next;
}

/**
 * 应用宿主登记的权威顺序（order 帧）：按它重排已知工作区，未在名单内的保留在
 * 原位、名单里尚未下发到本端的 id 自然略过，避免因为一次不完整的名单丢条目。
 */
export function orderWorkspaces(
  prev: WorkspaceView[],
  workspaceIds: string[],
): WorkspaceView[] {
  const rank = new Map(workspaceIds.map((id, index) => [id, index]));
  return [...prev].sort((a, b) => {
    const left = rank.get(a.workspaceId);
    const right = rank.get(b.workspaceId);
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });
}

/**
 * 在 ID 列表中重排单个条目（DOM-insertBefore 风格）：
 * 将 id 移至 beforeId 之前；beforeId 为 undefined 时追加到末尾。
 * 若目标位置与当前位置相同或 id 不存在，返回原数组不变。
 */
export function reorderIds(
  ids: string[],
  id: string,
  beforeId?: string,
): string[] {
  if (!ids.includes(id)) return ids;
  if (beforeId !== undefined && !ids.includes(beforeId)) return ids;
  if (id === beforeId) return ids;
  const without = ids.filter((item) => item !== id);
  const at =
    beforeId === undefined ? without.length : without.indexOf(beforeId);
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/**
 * 计算将 sourceId 移动到 targetId 的指定方位（"before" 或 "after"）时，
 * 传给 insertBefore 的参考锚点 beforeId，以及该移动是否引起顺序变化。
 */
export function calculateMoveAnchor(
  ids: string[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): { changed: boolean; beforeId?: string } {
  if (sourceId === targetId) return { changed: false };
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return { changed: false };

  let beforeId: string | undefined;
  if (position === "before") {
    beforeId = targetId;
    if (sourceIndex === targetIndex - 1) return { changed: false };
  } else {
    const withoutSource = ids.filter((id) => id !== sourceId);
    const targetIdxInWithout = withoutSource.indexOf(targetId);
    if (targetIdxInWithout === -1) return { changed: false };
    beforeId = withoutSource[targetIdxInWithout + 1];
    if (sourceIndex === targetIndex + 1) return { changed: false };
  }

  return { changed: true, beforeId };
}

/**
 * 根据 insertBefore 锚点原地重排 WorkspaceView 列表（用于乐观更新）。
 */
export function reorderWorkspaces(
  workspaces: WorkspaceView[],
  workspaceId: string,
  beforeWorkspaceId?: string,
): WorkspaceView[] {
  const ids = workspaces.map((w) => w.workspaceId);
  const nextIds = reorderIds(ids, workspaceId, beforeWorkspaceId);
  return orderWorkspaces(workspaces, nextIds);
}

/** 会话标题：AI 生成/用户命名的 title 投影优先，回退工作目录名。 */
export function sessionTitle(session: SessionSummary): string {
  const title = session.projections?.values?.title;
  if (typeof title === "string" && title.trim()) return title;
  if (session.cwd)
    return session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "未命名";
  return "未命名";
}

/**
 * 会话按最近更新时间倒序排列：最新的在最上方。
 * 更新时间相同时，按 sessionId 降序作为确定性平局决胜（tie-break），避免列表随机跳动。
 */
export function sortSessionsByRecency(
  sessions: SessionSummary[],
): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const timeA = a.updatedAt ?? 0;
    const timeB = b.updatedAt ?? 0;
    if (timeB !== timeA) return timeB - timeA;
    return b.sessionId.localeCompare(a.sessionId);
  });
}

