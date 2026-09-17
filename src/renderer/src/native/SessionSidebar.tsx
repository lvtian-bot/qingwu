import { useCallback, useMemo, useState } from "react";
import type { PendingKind } from "./PendingInteraction";
import { SessionRow, WorkspaceRow } from "./SidebarRows";
import type { SessionSummary, WorkspaceView } from "./protocol";
import {
  loadPinnedData,
  savePinnedData,
  sessionTitle,
  WORKSPACE_SESSION_PREVIEW_LIMIT,
  type PinnedData,
} from "./sidebar-data";
import { usePanelWidth } from "./usePanelWidth";

/** 搜索、置顶、分组展开与宽度由主组件持有生命周期，隐藏侧栏或切换界面时不丢失。 */
export function useSessionSidebar(
  sessions: SessionSummary[],
  workspaces: WorkspaceView[],
  archivedSet: Set<string>,
) {
  /** 侧栏置顶数据（本地持久化）。 */
  const [pinnedData, setPinnedData] = useState<PinnedData>(loadPinnedData);
  const toggleWorkspacePin = useCallback((workspaceId: string) => {
    setPinnedData((prev) => {
      const exists = prev.workspaces.includes(workspaceId);
      const nextWorkspaces = exists
        ? prev.workspaces.filter((id) => id !== workspaceId)
        : [workspaceId, ...prev.workspaces];
      const next = { ...prev, workspaces: nextWorkspaces };
      savePinnedData(next);
      return next;
    });
  }, []);

  const toggleSessionPin = useCallback((sessionId: string) => {
    setPinnedData((prev) => {
      const exists = prev.sessions.includes(sessionId);
      const nextSessions = exists
        ? prev.sessions.filter((id) => id !== sessionId)
        : [sessionId, ...prev.sessions];
      const next = { ...prev, sessions: nextSessions };
      savePinnedData(next);
      return next;
    });
  }, []);
  /** 会话搜索（纯前端标题过滤）。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  /** 侧栏折叠的分组标题集合。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  /** 项目会话组当前展示条数（缺省=默认上限；折叠项目或点「收起」即复位）。 */
  const [sessionVisibleByGroup, setSessionVisibleByGroup] = useState<
    Map<string, number>
  >(new Map());
  const sidebarPanel = usePanelWidth({
    storageKey: "qingwu.native.sidebarWidth",
    defaultWidth: 232,
    min: 180,
    max: 400,
  });
  /** 子代理会话（主对话派生的辅助会话）与已归档会话不在主列表展示。 */
  const visibleSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          !s.blank && s.origin !== "subagent" && !archivedSet.has(s.sessionId),
      ),
    [sessions, archivedSet],
  );

  const pinnedWsSet = useMemo(
    () => new Set(pinnedData.workspaces),
    [pinnedData.workspaces],
  );
  const pinnedSessionSet = useMemo(
    () => new Set(pinnedData.sessions),
    [pinnedData.sessions],
  );

  const filteredVisibleSessions = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return visibleSessions;
    return visibleSessions.filter((s) =>
      sessionTitle(s).toLowerCase().includes(keyword),
    );
  }, [visibleSessions, searchText]);

  const filteredSessionById = useMemo(
    () => new Map(filteredVisibleSessions.map((s) => [s.sessionId, s])),
    [filteredVisibleSessions],
  );

  const allWsSessionIds = useMemo(
    () => new Set(workspaces.flatMap((ws) => ws.sessionIds)),
    [workspaces],
  );

  /** 获取指定工作区下当前匹配的有效会话（保持工作区登记顺序） */
  const getWorkspaceSessions = useCallback(
    (ws: WorkspaceView) => {
      return ws.sessionIds
        .map((id) => filteredSessionById.get(id))
        .filter((s): s is SessionSummary => Boolean(s));
    },
    [filteredSessionById],
  );

  /** 判断工作区在搜索态下是否应呈现（名称匹配或内部有匹配会话） */
  const isWorkspaceMatched = useCallback(
    (ws: WorkspaceView, wsSessions: SessionSummary[]) => {
      const keyword = searchText.trim().toLowerCase();
      if (!keyword) return true;
      if (ws.title.toLowerCase().includes(keyword)) return true;
      return wsSessions.length > 0;
    },
    [searchText],
  );

  // 1. 置顶项目（保持置顶时间倒序）
  const pinnedWorkspaces = useMemo(() => {
    const wsMap = new Map(workspaces.map((w) => [w.workspaceId, w]));
    return pinnedData.workspaces
      .map((id) => wsMap.get(id))
      .filter((w): w is WorkspaceView => Boolean(w));
  }, [workspaces, pinnedData.workspaces]);

  // 2. 置顶会话（保持置顶时间倒序，包含独立会话与项目内会话）
  const pinnedSessionsList = useMemo(() => {
    return pinnedData.sessions
      .map((id) => filteredSessionById.get(id))
      .filter((s): s is SessionSummary => Boolean(s));
  }, [pinnedData.sessions, filteredSessionById]);

  // 3. 普通项目（排除已置顶的项目）
  const normalWorkspaces = useMemo(() => {
    return workspaces.filter((ws) => !pinnedWsSet.has(ws.workspaceId));
  }, [workspaces, pinnedWsSet]);

  // 4. 普通独立会话（未关联项目且未置顶）
  const normalUngroupedSessions = useMemo(() => {
    return filteredVisibleSessions.filter(
      (s) =>
        !allWsSessionIds.has(s.sessionId) && !pinnedSessionSet.has(s.sessionId),
    );
  }, [filteredVisibleSessions, allWsSessionIds, pinnedSessionSet]);

  return {
    pinnedSessionSet,
    searchOpen,
    setSearchOpen,
    searchText,
    setSearchText,
    collapsedGroups,
    setCollapsedGroups,
    sessionVisibleByGroup,
    setSessionVisibleByGroup,
    sidebarPanel,
    toggleWorkspacePin,
    toggleSessionPin,
    getWorkspaceSessions,
    isWorkspaceMatched,
    pinnedWorkspaces,
    pinnedSessionsList,
    normalWorkspaces,
    normalUngroupedSessions,
  };
}

interface SessionSidebarProps {
  state: ReturnType<typeof useSessionSidebar>;
  collapsed: boolean;
  currentId: string | null;
  pendingKindBySession: Map<string, PendingKind>;
  unreadFinishedSessionIds: Set<string>;
  openSession: (id: string) => void;
  createSessionIn: (id: string) => Promise<string>;
  handleNewSession: () => Promise<void>;
  handleAddWorkspace: () => Promise<string | null>;
  handleWorkspaceRename: (id: string, title: string) => void;
  handleWorkspaceDelete: (id: string) => void;
  handleSessionRename: (id: string, title: string) => Promise<void>;
  handleSessionArchive: (id: string) => Promise<void>;
  setError: (message: string) => void;
}

export function SessionSidebar({
  state,
  collapsed,
  currentId,
  pendingKindBySession,
  unreadFinishedSessionIds,
  openSession,
  createSessionIn,
  handleNewSession,
  handleAddWorkspace,
  handleWorkspaceRename,
  handleWorkspaceDelete,
  handleSessionRename,
  handleSessionArchive,
  setError,
}: SessionSidebarProps) {
  const {
    pinnedSessionSet,
    searchOpen,
    setSearchOpen,
    searchText,
    setSearchText,
    collapsedGroups,
    setCollapsedGroups,
    sessionVisibleByGroup,
    setSessionVisibleByGroup,
    sidebarPanel,
    toggleWorkspacePin,
    toggleSessionPin,
    getWorkspaceSessions,
    isWorkspaceMatched,
    pinnedWorkspaces,
    pinnedSessionsList,
    normalWorkspaces,
    normalUngroupedSessions,
  } = state;
  if (collapsed) return null;
  /** 折叠/展开项目分组；折叠时同时复位该组会话展示条数，再点开回到默认上限。 */
  const toggleWorkspaceGroup = (workspaceId: string) => {
    const collapsing = !collapsedGroups.has(workspaceId);
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (collapsing) next.add(workspaceId);
      else next.delete(workspaceId);
      return next;
    });
    if (!collapsing) return;
    setSessionVisibleByGroup((prev) => {
      const next = new Map(prev);
      next.delete(workspaceId);
      return next;
    });
  };

  /**
   * 项目内会话列表：默认最多展示 WORKSPACE_SESSION_PREVIEW_LIMIT 条，
   * 每点一次「展开显示」多展示一批，全部展示后按钮变「收起」（复位回默认条数）。
   * 折叠项目再点开同样回到默认条数。搜索态不设上限——匹配结果被折叠会让用户以为没搜到。
   */
  const renderWorkspaceSessions = (
    ws: WorkspaceView,
    wsSessions: SessionSummary[],
  ) => {
    if (collapsedGroups.has(ws.workspaceId)) return null;
    const searching = searchText.trim() !== "";
    const visibleCount = Math.max(
      searching ? wsSessions.length : WORKSPACE_SESSION_PREVIEW_LIMIT,
      sessionVisibleByGroup.get(ws.workspaceId) ?? 0,
    );
    const visible = wsSessions.slice(0, visibleCount);
    const hiddenCount = wsSessions.length - visible.length;
    return (
      <>
        {visible.map((session) => (
          <SessionRow
            key={session.sessionId}
            title={sessionTitle(session)}
            tooltip={session.cwd ?? session.sessionId}
            active={session.sessionId === currentId}
            pinned={pinnedSessionSet.has(session.sessionId)}
            running={session.running}
            pending={pendingKindBySession.get(session.sessionId) ?? null}
            unread={unreadFinishedSessionIds.has(session.sessionId)}
            indented
            onClick={() => openSession(session.sessionId)}
            onTogglePin={() => toggleSessionPin(session.sessionId)}
            onRename={(t) => void handleSessionRename(session.sessionId, t)}
            onArchive={() => void handleSessionArchive(session.sessionId)}
          />
        ))}
        {!searching &&
          (hiddenCount > 0 ||
            visibleCount > WORKSPACE_SESSION_PREVIEW_LIMIT) && (
            <button
              type="button"
              className="native-session-overflow"
              aria-expanded={hiddenCount === 0}
              onClick={() =>
                setSessionVisibleByGroup((prev) => {
                  const next = new Map(prev);
                  if (hiddenCount > 0) {
                    next.set(
                      ws.workspaceId,
                      visibleCount + WORKSPACE_SESSION_PREVIEW_LIMIT,
                    );
                  } else {
                    next.delete(ws.workspaceId);
                  }
                  return next;
                })
              }
            >
              {hiddenCount > 0 ? "展开显示" : "收起"}
            </button>
          )}
      </>
    );
  };

  return (
    <>
      <aside className="native-sidebar" style={{ width: sidebarPanel.width }}>
        <div className="native-sidebar-brand">
          <span>青梧</span>
          <button
            className="native-sidebar-search-toggle"
            onClick={() => {
              setSearchOpen((v) => !v);
              setSearchText("");
            }}
            title="搜索会话"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
        </div>
        {searchOpen && (
          <div className="native-sidebar-search">
            <input
              autoFocus
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索会话"
            />
          </div>
        )}
        <button
          className="native-nav-item"
          onClick={() => void handleNewSession()}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          新会话
        </button>
        <div className="native-session-list">
          {/* 1. 置顶区间 */}
          {(pinnedWorkspaces.length > 0 || pinnedSessionsList.length > 0) && (
            <div className="native-sidebar-section">
              <div className="native-sidebar-section-header">
                <span className="native-sidebar-section-title">置顶</span>
              </div>
              <div className="native-sidebar-section-content">
                {pinnedWorkspaces.map((ws) => {
                  const wsSessions = getWorkspaceSessions(ws);
                  if (!isWorkspaceMatched(ws, wsSessions)) return null;
                  return (
                    <div
                      key={ws.workspaceId}
                      className="native-session-group native-session-group-ws"
                    >
                      <WorkspaceRow
                        workspace={ws}
                        collapsed={collapsedGroups.has(ws.workspaceId)}
                        pinned={true}
                        onToggle={() => toggleWorkspaceGroup(ws.workspaceId)}
                        onNewSession={() =>
                          void createSessionIn(ws.workspaceId).catch((err) =>
                            setError(
                              err instanceof Error ? err.message : String(err),
                            ),
                          )
                        }
                        onRename={(title) =>
                          handleWorkspaceRename(ws.workspaceId, title)
                        }
                        onDelete={() => handleWorkspaceDelete(ws.workspaceId)}
                        onTogglePin={() => toggleWorkspacePin(ws.workspaceId)}
                      />
                      {renderWorkspaceSessions(ws, wsSessions)}
                    </div>
                  );
                })}
                {pinnedSessionsList.map((session) => (
                  <SessionRow
                    key={session.sessionId}
                    title={sessionTitle(session)}
                    tooltip={session.cwd ?? session.sessionId}
                    active={session.sessionId === currentId}
                    pinned={true}
                    running={session.running}
                    pending={
                      pendingKindBySession.get(session.sessionId) ?? null
                    }
                    unread={unreadFinishedSessionIds.has(session.sessionId)}
                    onClick={() => openSession(session.sessionId)}
                    onTogglePin={() => toggleSessionPin(session.sessionId)}
                    onRename={(t) =>
                      void handleSessionRename(session.sessionId, t)
                    }
                    onArchive={() =>
                      void handleSessionArchive(session.sessionId)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* 2. 项目区间 */}
          <div className="native-sidebar-section">
            <div className="native-sidebar-section-header">
              <span className="native-sidebar-section-title">项目</span>
              <button
                className="native-sidebar-section-act"
                onClick={() => void handleAddWorkspace()}
                title="添加项目"
                aria-label="添加项目"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <div className="native-sidebar-section-content">
              {normalWorkspaces.map((ws) => {
                const wsSessions = getWorkspaceSessions(ws);
                if (!isWorkspaceMatched(ws, wsSessions)) return null;
                return (
                  <div
                    key={ws.workspaceId}
                    className="native-session-group native-session-group-ws"
                  >
                    <WorkspaceRow
                      workspace={ws}
                      collapsed={collapsedGroups.has(ws.workspaceId)}
                      pinned={false}
                      onToggle={() => toggleWorkspaceGroup(ws.workspaceId)}
                      onNewSession={() =>
                        void createSessionIn(ws.workspaceId).catch((err) =>
                          setError(
                            err instanceof Error ? err.message : String(err),
                          ),
                        )
                      }
                      onRename={(title) =>
                        handleWorkspaceRename(ws.workspaceId, title)
                      }
                      onDelete={() => handleWorkspaceDelete(ws.workspaceId)}
                      onTogglePin={() => toggleWorkspacePin(ws.workspaceId)}
                    />
                    {renderWorkspaceSessions(ws, wsSessions)}
                  </div>
                );
              })}
              {normalWorkspaces.length === 0 &&
                pinnedWorkspaces.length === 0 && (
                  <div className="native-sidebar-empty-hint">暂无项目</div>
                )}
            </div>
          </div>

          {/* 3. 会话区间（无项目独立日常会话） */}
          {normalUngroupedSessions.length > 0 && (
            <div className="native-sidebar-section">
              <div className="native-sidebar-section-header">
                <span className="native-sidebar-section-title">会话</span>
              </div>
              <div className="native-sidebar-section-content">
                {normalUngroupedSessions.map((session) => (
                  <SessionRow
                    key={session.sessionId}
                    title={sessionTitle(session)}
                    tooltip={session.cwd ?? session.sessionId}
                    active={session.sessionId === currentId}
                    pinned={false}
                    running={session.running}
                    pending={
                      pendingKindBySession.get(session.sessionId) ?? null
                    }
                    unread={unreadFinishedSessionIds.has(session.sessionId)}
                    onClick={() => openSession(session.sessionId)}
                    onTogglePin={() => toggleSessionPin(session.sessionId)}
                    onRename={(t) =>
                      void handleSessionRename(session.sessionId, t)
                    }
                    onArchive={() =>
                      void handleSessionArchive(session.sessionId)
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      <div
        className="native-resizer"
        role="separator"
        aria-orientation="vertical"
        title="拖动调节宽度，双击复位"
        onPointerDown={(e) => sidebarPanel.startDrag(e, 1)}
        onDoubleClick={sidebarPanel.reset}
      />
    </>
  );
}
