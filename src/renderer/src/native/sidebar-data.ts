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

/** 会话标题：AI 生成/用户命名的 title 投影优先，回退工作目录名。 */
export function sessionTitle(session: SessionSummary): string {
  const title = session.projections?.values?.title;
  if (typeof title === "string" && title.trim()) return title;
  if (session.cwd)
    return session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "未命名";
  return "未命名";
}
