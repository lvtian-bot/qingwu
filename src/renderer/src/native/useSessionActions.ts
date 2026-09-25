/**
 * 会话与工作区操作：选中/新建会话、工作区注册/重命名/删除/排序、
 * 会话重命名/归档/解归档，以及引导页工作区落点切换。
 */
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ComposerDraftsApi } from "./useComposerDrafts";
import { rpc, toErrMsg } from "./rpc";
import { Endpoints } from "./protocol";
import type { SessionSummary, WorkspaceView } from "./protocol";
import { orderWorkspaces } from "./sidebar-data";

interface SessionActionsOptions {
  sessions: SessionSummary[];
  workspaces: WorkspaceView[];
  /** 已归档会话集合：新建会话时不复用已归档的空白会话。 */
  archivedSet: Set<string>;
  currentId: string | null;
  activeWorkspaceId: string | null;
  /** 会话 → 所属工作区映射（点击会话时更新活跃工作区）。 */
  workspaceOfSession: Map<string, string>;
  refreshSessions: () => Promise<void>;
  setError: (message: string | null) => void;
  /** 草稿桶迁移（换工作区落点时旧会话草稿随人走）。 */
  drafts: Pick<ComposerDraftsApi, "migrateBuckets">;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setWorkspaces: Dispatch<SetStateAction<WorkspaceView[]>>;
  setArchivedSessionIds: Dispatch<SetStateAction<string[]>>;
  setUnreadFinishedSessionIds: Dispatch<SetStateAction<Set<string>>>;
  setCurrentId: (sessionId: string | null) => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
}

export function useSessionActions({
  sessions,
  workspaces,
  archivedSet,
  currentId,
  activeWorkspaceId,
  workspaceOfSession,
  refreshSessions,
  setError,
  drafts,
  setSessions,
  setWorkspaces,
  setArchivedSessionIds,
  setUnreadFinishedSessionIds,
  setCurrentId,
  setActiveWorkspaceId,
  setSettingsOpen,
}: SessionActionsOptions) {
  const openSession = (sessionId: string) => {
    setCurrentId(sessionId);
    setUnreadFinishedSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    const wsId = workspaceOfSession.get(sessionId);
    if (wsId) setActiveWorkspaceId(wsId);
  };

  /** 在指定项目下落一个新会话：优先复用其空白会话（官方 connectWorkspace 语义）。返回会话 id。 */
  const createSessionIn = async (wsId: string): Promise<string> => {
    const ws = workspaces.find((w) => w.workspaceId === wsId);
    const reusable = ws?.sessionIds
      .map((id) => sessions.find((s) => s.sessionId === id))
      .find(
        (s) =>
          s?.blank && s.origin !== "subagent" && !archivedSet.has(s.sessionId),
      );
    if (reusable) {
      setCurrentId(reusable.sessionId);
      return reusable.sessionId;
    }
    const value = await rpc<{ sessionId: string }>(Endpoints.sessionCreate, {
      request: { workspaceId: wsId },
    });
    await refreshSessions();
    setCurrentId(value.sessionId);
    return value.sessionId;
  };

  /**
   * 新会话：对齐官方 startSession 语义——落在当前/最近活跃项目并复用空白会话；
   * 零项目时先添加第一个项目（添加工作区统一收口到聊天框 chip，这里是兜底）。
   */
  const handleNewSession = async () => {
    let wsId = activeWorkspaceId;
    if (!wsId) {
      wsId = await handleAddWorkspace();
      if (!wsId) return;
    }
    try {
      await createSessionIn(wsId);
    } catch (err) {
      setError(toErrMsg(err));
    }
  };

  /** 选目录并注册工作区；用户取消返回 null。 */
  const addWorkspace = async (): Promise<string | null> => {
    const picked = await rpc<string | null>(Endpoints.directoryPickerPick, {});
    if (!picked) return null;
    const created = await rpc<{ workspace: WorkspaceView; created: boolean }>(
      Endpoints.workspaceCreate,
      { request: { path: picked } },
    );
    setActiveWorkspaceId(created.workspace.workspaceId);
    await refreshSessions();
    return created.workspace.workspaceId;
  };

  /** 添加工作区入口（chip 菜单/零工作区兜底）：添加后不建会话，新会话落点已指向它。 */
  const handleAddWorkspace = async (): Promise<string | null> => {
    try {
      return await addWorkspace();
    } catch (err) {
      setError(toErrMsg(err));
      return null;
    }
  };

  /** 重命名工作区（workspace/rename，follow 流推送 upsert 自动回填列表）。 */
  const handleWorkspaceRename = (workspaceId: string, title: string) => {
    void rpc(Endpoints.workspaceRename, {
      request: { workspaceId, title },
    }).catch((err) => setError(toErrMsg(err)));
  };

  /** 删除工作区注册：会话归入「未分组」，活跃落点回退到剩余首个工作区。 */
  const handleWorkspaceDelete = (workspaceId: string) => {
    void (async () => {
      await rpc(Endpoints.workspaceDelete, { request: { workspaceId } });
      if (activeWorkspaceId === workspaceId) {
        const rest = workspaces.find((w) => w.workspaceId !== workspaceId);
        setActiveWorkspaceId(rest?.workspaceId ?? null);
      }
    })().catch((err) => setError(toErrMsg(err)));
  };

  /** 调整工作区顺序（workspace/insertBefore，follow 流推送 order 帧自动更新列表）。 */
  const handleWorkspaceReorder = useCallback(
    async (workspaceId: string, beforeWorkspaceId?: string) => {
      try {
        const result = await rpc<{ workspaceIds: string[] }>(
          Endpoints.workspaceInsertBefore,
          {
            request: {
              workspaceId,
              ...(beforeWorkspaceId ? { beforeWorkspaceId } : {}),
            },
          },
        );
        if (result?.workspaceIds) {
          setWorkspaces((prev) => orderWorkspaces(prev, result.workspaceIds));
        }
      } catch (err) {
        setError(toErrMsg(err));
      }
    },
    [setWorkspaces, setError],
  );

  /** 重命名会话（session/rename，更新本地会话投影标题）。 */
  const handleSessionRename = useCallback(
    async (sessionId: string, title: string) => {
      try {
        await rpc(Endpoints.sessionRename, {
          request: { sessionId, title },
        });
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === sessionId
              ? {
                  ...s,
                  projections: s.projections
                    ? {
                        ...s.projections,
                        values: { ...s.projections.values, title },
                      }
                    : {
                        asOfSeq: 0,
                        values: { title },
                      },
                }
              : s,
          ),
        );
        await refreshSessions();
      } catch (err) {
        setError(toErrMsg(err));
      }
    },
    [setSessions, refreshSessions, setError],
  );

  /** 归档会话（workspace/archiveSession，从主列表排除）。 */
  const handleSessionArchive = useCallback(
    async (sessionId: string) => {
      try {
        await rpc(Endpoints.workspaceArchiveSession, {
          request: { sessionId },
        });
        setArchivedSessionIds((prev) => [...prev, sessionId]);
        if (currentId === sessionId) {
          setCurrentId(null);
        }
      } catch (err) {
        setError(toErrMsg(err));
      }
    },
    [currentId, setArchivedSessionIds, setCurrentId, setError],
  );

  /**
   * 分叉善后：引擎 fork 不复制标题、模型回到默认选择，这里补齐——
   * 子会话改名「源标题 · 分支」以便侧栏辨识，并延续源会话的生效模型选择。
   * 任一步失败都不阻断进入子会话，错误照常上报。
   */
  const settleForkedSession = async (childId: string, sourceId: string) => {
    const source = sessions.find((s) => s.sessionId === sourceId);
    const title = source?.projections?.values?.title;
    const selection = source?.projections?.values?.modelSelection?.next;
    if (title) {
      await rpc(Endpoints.sessionRename, {
        request: { sessionId: childId, title: `${title} · 分支` },
      });
    }
    if (selection) {
      await rpc(Endpoints.sessionSelectModel, {
        request: { sessionId: childId, ...selection },
      });
    }
  };

  /**
   * 从指定答复分叉出新会话（session/fork，atSeq 为包含切点的日志事件 seq）：
   * 子会话继承截至该轮答复的完整对话与工作区归属，原会话保持不动。
   */
  const handleSessionFork = async (sessionId: string, atSeq: number) => {
    try {
      const value = await rpc<{ sessionId: string }>(Endpoints.sessionFork, {
        request: { sessionId, atSeq },
      });
      const childId = value.sessionId;
      try {
        await settleForkedSession(childId, sessionId);
      } catch (settleErr) {
        setError(toErrMsg(settleErr));
      }
      await refreshSessions();
      openSession(childId);
    } catch (err) {
      const message = toErrMsg(err);
      setError(
        message.includes("fork-unavailable") ? "当前会话不支持分叉" : message,
      );
    }
  };

  /** 取消归档会话（workspace/unarchiveSession，恢复到主列表）。 */
  const handleSessionUnarchive = useCallback(
    async (sessionId: string) => {
      try {
        await rpc(Endpoints.workspaceUnarchiveSession, {
          request: { sessionId },
        });
        setArchivedSessionIds((prev) => prev.filter((id) => id !== sessionId));
      } catch (err) {
        setError(toErrMsg(err));
        throw err;
      }
    },
    [setArchivedSessionIds, setError],
  );

  /** 恢复并直接打开会话（取消归档 + 选中会话 + 关闭设置）。 */
  const handleRestoreAndOpenSession = useCallback(
    async (sessionId: string) => {
      await handleSessionUnarchive(sessionId);
      setCurrentId(sessionId);
      setSettingsOpen(false);
    },
    [handleSessionUnarchive, setCurrentId, setSettingsOpen],
  );

  /**
   * 引导页工作区 chip 选择：切换新会话落点——在目标工作区建/复用一个空白会话再切过去。
   * 引擎不支持给已有会话改工作区归属：工作区归属在会话创建时按 cwd 写死，而
   * workspace/insertSessionBefore 只受理该项目已登记的会话，跨项目一律 workspace/move-invalid。
   * 因此这里对齐官方 openWorkspace 语义——换的是落点而不是会话本身：未发送的草稿随人迁移，
   * 原来那个空白会话留在原工作区，下次进入该工作区时被复用。
   */
  const handleWorkspaceChipPick = (workspaceId: string) => {
    if (!currentId) {
      setActiveWorkspaceId(workspaceId);
      return;
    }
    if (workspaceOfSession.get(currentId) === workspaceId) return;
    void (async () => {
      const previousId = currentId;
      const nextId = await createSessionIn(workspaceId);
      setActiveWorkspaceId(workspaceId);
      if (nextId === previousId) return;
      // 草稿随人走：旧会话的草稿落到目标会话，旧桶清空，避免回头再进它时又冒出来
      drafts.migrateBuckets(previousId, nextId);
    })().catch((err) => setError(toErrMsg(err)));
  };

  return {
    openSession,
    createSessionIn,
    handleNewSession,
    handleAddWorkspace,
    handleWorkspaceRename,
    handleWorkspaceDelete,
    handleWorkspaceReorder,
    handleSessionRename,
    handleSessionArchive,
    handleSessionFork,
    handleSessionUnarchive,
    handleRestoreAndOpenSession,
    handleWorkspaceChipPick,
  };
}

/** 会话/工作区操作集：侧栏、引导页 chip 与发送管线共用的处理器。 */
export type SessionActionsApi = ReturnType<typeof useSessionActions>;
