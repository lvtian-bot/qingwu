import { useEffect, useRef, useState } from "react";
import { PENDING_LABELS, type PendingKind } from "./PendingInteraction";
import type { WorkspaceView } from "./protocol";

/**
 * 侧栏工作区行：胶囊底色 + 文件夹图标，点击主体展开/收起会话列表；
 * 悬停浮现「新建会话」与「···」操作菜单（重命名 / 删除），对齐 ChatGPT 桌面版项目分组。
 */
export function WorkspaceRow({
  workspace,
  collapsed,
  pinned,
  onToggle,
  onNewSession,
  onRename,
  onDelete,
  onTogglePin,
}: {
  workspace: WorkspaceView;
  collapsed: boolean;
  pinned?: boolean;
  onToggle: () => void;
  onNewSession: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(workspace.title);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // 工作区标题更新（rename 后 follow 流推送）时同步草稿，避免下一次编辑带回旧值
  useEffect(() => {
    if (!renaming) setDraftTitle(workspace.title);
  }, [workspace.title, renaming]);

  const commitRename = () => {
    const next = draftTitle.trim();
    setRenaming(false);
    if (next && next !== workspace.title) onRename(next);
    else setDraftTitle(workspace.title);
  };

  return (
    <div
      className={`native-ws-row${collapsed ? " collapsed" : ""}`}
      ref={rootRef}
    >
      {renaming ? (
        <input
          className="native-ws-rename"
          value={draftTitle}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
            if (e.key === "Escape") {
              setDraftTitle(workspace.title);
              setRenaming(false);
            }
          }}
          onBlur={commitRename}
          aria-label="工作区名称"
        />
      ) : (
        <>
          <button
            className="native-ws-main"
            onClick={onToggle}
            title={workspace.path}
          >
            {/* 文件夹图标即展开/收起状态指示：展开显示打开的文件夹，收起显示关闭的 */}
            <svg
              className="native-ws-icon"
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
              {collapsed ? (
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
              ) : (
                <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
              )}
            </svg>
            <span className="native-ws-title">{workspace.title}</span>
          </button>
          {onTogglePin && (
            <button
              className={`native-ws-act${pinned ? " pinned" : ""}`}
              onClick={onTogglePin}
              title={pinned ? "取消置顶项目" : "置顶项目"}
              aria-label={pinned ? "取消置顶项目" : "置顶项目"}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill={pinned ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="17" x2="12" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V5h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v5.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z" />
              </svg>
            </button>
          )}
          <button
            className={`native-ws-act${menuOpen ? " visible" : ""}`}
            onClick={() => {
              setMenuOpen((v) => !v);
              setConfirmDelete(false);
            }}
            title="工作区操作"
            aria-label={`工作区“${workspace.title}”的操作`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          <button
            className="native-ws-act"
            onClick={onNewSession}
            title={`在“${workspace.title}”中新建会话`}
            aria-label={`在“${workspace.title}”中新建会话`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
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
          {menuOpen && !confirmDelete && (
            <div className="native-ws-menu">
              {onTogglePin && (
                <button
                  className="native-popover-item"
                  onClick={() => {
                    onTogglePin();
                    setMenuOpen(false);
                  }}
                >
                  <span className="native-popover-item-name">
                    {pinned ? "取消置顶项目" : "置顶项目"}
                  </span>
                </button>
              )}
              <button
                className="native-popover-item"
                onClick={() => {
                  void window.qingwu?.openTerminal?.(workspace.path);
                  setMenuOpen(false);
                }}
              >
                <span className="native-popover-item-name">在终端中打开</span>
              </button>
              <button
                className="native-popover-item"
                onClick={() => {
                  void window.qingwu?.openPath?.(workspace.path);
                  setMenuOpen(false);
                }}
              >
                <span className="native-popover-item-name">在文件管理器中打开</span>
              </button>
              <button
                className="native-popover-item"
                onClick={() => {
                  setRenaming(true);
                  setMenuOpen(false);
                }}
              >
                <span className="native-popover-item-name">重命名工作区</span>
              </button>
              <button
                className="native-popover-item native-ws-menu-delete"
                onClick={() => setConfirmDelete(true)}
              >
                <span className="native-popover-item-name">删除工作区</span>
              </button>
            </div>
          )}
          {menuOpen && confirmDelete && (
            <div className="native-ws-menu">
              <div className="native-ws-confirm-text">
                将把“{workspace.title}
                ”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。
              </div>
              <div className="native-ws-confirm-actions">
                <button
                  className="native-ws-confirm-cancel"
                  onClick={() => {
                    setConfirmDelete(false);
                    setMenuOpen(false);
                  }}
                >
                  取消
                </button>
                <button
                  className="native-ws-confirm-go"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDelete(false);
                    onDelete();
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 会话行的状态标记：等待回答/授权优先于「运行中」，再次为「未查看完成」。 */
function SessionStatusMark({
  running,
  pending,
  unread,
}: {
  running: boolean;
  pending: PendingKind | null;
  unread?: boolean;
}) {
  if (pending) {
    return (
      <span
        className="native-status-mark native-waiting-dot"
        title={PENDING_LABELS[pending]}
      />
    );
  }
  if (running) {
    return (
      <span
        className="native-status-mark native-running-dot"
        title="任务进行中"
      />
    );
  }
  if (unread) {
    return (
      <span
        className="native-status-mark native-unread-dot"
        title="任务已完成，未查看"
      />
    );
  }
  return null;
}

/**
 * 侧栏会话行：左侧状态指示（进行中/等待中/未查看） + 会话标题；
 * 悬停浮现「···」操作菜单（置顶 / 重命名 / 归档）；
 * 支持 indented 缩进（从属于项目分组时使用）。
 */
export function SessionRow({
  title,
  tooltip,
  active,
  pinned,
  running,
  pending,
  unread,
  indented,
  onClick,
  onTogglePin,
  onRename,
  onArchive,
}: {
  title: string;
  tooltip?: string;
  active: boolean;
  pinned: boolean;
  running?: boolean;
  pending: PendingKind | null;
  unread?: boolean;
  indented?: boolean;
  onClick: () => void;
  onTogglePin?: () => void;
  onRename?: (title: string) => void;
  onArchive?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!renaming) setDraftTitle(title);
  }, [title, renaming]);

  const commitRename = () => {
    const next = draftTitle.trim();
    setRenaming(false);
    if (next && next !== title && onRename) onRename(next);
    else setDraftTitle(title);
  };

  return (
    <div
      className={`native-session-row${active ? " active" : ""}${indented ? " indented" : ""}`}
      ref={rootRef}
    >
      {renaming ? (
        <input
          className="native-session-rename"
          value={draftTitle}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
            if (e.key === "Escape") {
              setDraftTitle(title);
              setRenaming(false);
            }
          }}
          onBlur={commitRename}
          aria-label="会话名称"
        />
      ) : (
        <>
          <button
            className="native-session-main"
            onClick={onClick}
            title={tooltip}
          >
            {/* 状态小圆点位于会话标题左侧 */}
            <SessionStatusMark
              running={Boolean(running)}
              pending={pending}
              unread={unread}
            />
            <span className="native-session-title">{title}</span>
          </button>
          <button
            className={`native-session-act${menuOpen ? " visible" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="会话操作"
            aria-label={`会话“${title}”的操作`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          {menuOpen && (
            <div className="native-session-menu">
              {onTogglePin && (
                <button
                  className="native-popover-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onTogglePin();
                  }}
                >
                  <span className="native-popover-item-name">
                    {pinned ? "取消置顶" : "置顶会话"}
                  </span>
                </button>
              )}
              {onRename && (
                <button
                  className="native-popover-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                >
                  <span className="native-popover-item-name">重命名</span>
                </button>
              )}
              {onArchive && (
                <button
                  className="native-popover-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onArchive();
                  }}
                >
                  <span className="native-popover-item-name">归档会话</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
