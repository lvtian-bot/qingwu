import { useMemo, useState } from "react";
import type { SessionSummary, WorkspaceView } from "./protocol";
import { sessionTitle } from "./sidebar-data";
import { formatRelativeTime } from "./settings-domain";
import type { DshSettingsController } from "./useDshSettings";

/** 已归档会话分区：搜索、取消归档与恢复打开。 */
export function ArchivedSessionsTab({
  sessions = [],
  workspaces = [],
  archivedSessionIds = [],
  onUnarchiveSession,
  onOpenSession,
  dsh,
}: {
  /** 会话列表快照：用于展示已归档会话标题与时间 */
  sessions?: SessionSummary[];
  /** 工作区列表快照：用于解析已归档会话所属项目 */
  workspaces?: WorkspaceView[];
  /** 全局已归档会话 ID 列表 */
  archivedSessionIds?: string[];
  /** 取消归档回调 */
  onUnarchiveSession?: (sessionId: string) => Promise<void>;
  /** 恢复并打开会话回调 */
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  dsh: DshSettingsController;
}) {
  const [archivedSearchQuery, setArchivedSearchQuery] = useState("");
  const [unarchivingIds, setUnarchivingIds] = useState<Set<string>>(new Set());

  const archivedRows = useMemo(() => {
    if (!archivedSessionIds || archivedSessionIds.length === 0) return [];
    const sessionMap = new Map<string, SessionSummary>();
    if (sessions) {
      for (const s of sessions) {
        sessionMap.set(s.sessionId, s);
      }
    }
    const wsMap = new Map<string, string>();
    if (workspaces) {
      for (const ws of workspaces) {
        for (const sid of ws.sessionIds) {
          wsMap.set(sid, ws.title || "未命名项目");
        }
      }
    }
    return [...archivedSessionIds].reverse().map((id) => {
      const summary = sessionMap.get(id);
      const title = summary ? sessionTitle(summary) : "未命名会话";
      const workspaceName = wsMap.get(id) ?? "未分组";
      const updatedAt = summary?.updatedAt ?? 0;
      return { id, title, workspaceName, updatedAt };
    });
  }, [archivedSessionIds, sessions, workspaces]);

  const filteredArchivedRows = useMemo(() => {
    const q = archivedSearchQuery.trim().toLowerCase();
    if (!q) return archivedRows;
    return archivedRows.filter(
      (row) =>
        row.title.toLowerCase().includes(q) ||
        row.workspaceName.toLowerCase().includes(q),
    );
  }, [archivedRows, archivedSearchQuery]);

  const handleUnarchive = async (sessionId: string) => {
    if (unarchivingIds.has(sessionId)) return;
    setUnarchivingIds((prev) => new Set(prev).add(sessionId));
    try {
      if (onUnarchiveSession) {
        await onUnarchiveSession(sessionId);
      }
    } catch (e) {
      dsh.reportError(
        `取消归档失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setUnarchivingIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  const handleOpenArchived = async (sessionId: string) => {
    if (onOpenSession) {
      await onOpenSession(sessionId);
    } else {
      await handleUnarchive(sessionId);
    }
  };

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>已归档会话</h2>
        <p>管理已从主列表中归档的会话，可随时恢复到对应项目或未分组列表中。</p>
      </div>

      {archivedRows.length > 0 && (
        <div className="native-archived-toolbar">
          <div className="native-archived-search">
            <svg
              className="native-archived-search-icon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="currentColor"
            >
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
            </svg>
            <input
              type="search"
              className="native-settings-input native-archived-search-input"
              placeholder="搜索已归档会话（按标题或项目）..."
              value={archivedSearchQuery}
              onChange={(e) => setArchivedSearchQuery(e.target.value)}
            />
            {archivedSearchQuery && (
              <button
                type="button"
                className="native-archived-search-clear"
                onClick={() => setArchivedSearchQuery("")}
                title="清空搜索"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  fill="currentColor"
                >
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                </svg>
              </button>
            )}
          </div>
          <span className="native-archived-count">
            {archivedSearchQuery
              ? `匹配 ${filteredArchivedRows.length} / 共 ${archivedRows.length} 个会话`
              : `共 ${archivedRows.length} 个已归档会话`}
          </span>
        </div>
      )}

      {archivedRows.length === 0 ? (
        <div className="native-archived-empty">
          <div className="native-archived-empty-icon">
            <svg viewBox="0 0 16 16" width="36" height="36" fill="currentColor">
              <path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1V2zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5H2zm13-3H1v2h14V2zM5 7.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z" />
            </svg>
          </div>
          <div className="native-archived-empty-title">暂无已归档会话</div>
          <div className="native-archived-empty-desc">
            在侧边栏会话菜单中选择「归档会话」，即可将暂不使用的会话收纳至此处，主界面更整齐清爽。
          </div>
        </div>
      ) : filteredArchivedRows.length === 0 ? (
        <div className="native-archived-empty">
          <div className="native-archived-empty-title">
            未找到匹配的已归档会话
          </div>
          <div className="native-archived-empty-desc">
            没有会话匹配关键字 “{archivedSearchQuery}”，请尝试更换搜索词。
          </div>
          <button
            type="button"
            className="native-btn native-btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => setArchivedSearchQuery("")}
          >
            清空搜索词
          </button>
        </div>
      ) : (
        <div className="native-settings-card native-archived-list-card">
          {filteredArchivedRows.map((row) => (
            <div key={row.id} className="native-archived-row">
              <div className="native-archived-row-main">
                <div className="native-archived-row-title" title={row.title}>
                  {row.title}
                </div>
                <div className="native-archived-row-meta">
                  <span
                    className="native-archived-tag"
                    title={`所属项目: ${row.workspaceName}`}
                  >
                    {row.workspaceName}
                  </span>
                  <span className="native-archived-dot">·</span>
                  <span className="native-archived-time">
                    {formatRelativeTime(row.updatedAt)}
                  </span>
                </div>
              </div>
              <div className="native-archived-row-actions">
                {onOpenSession && (
                  <button
                    type="button"
                    className="native-btn native-btn-secondary native-archived-btn"
                    onClick={() => void handleOpenArchived(row.id)}
                    title="恢复此会话并立即打开"
                  >
                    恢复并打开
                  </button>
                )}
                <button
                  type="button"
                  className="native-btn native-btn-secondary native-archived-btn"
                  disabled={unarchivingIds.has(row.id)}
                  onClick={() => void handleUnarchive(row.id)}
                  title="取消归档，放回原项目或会话列表"
                >
                  {unarchivingIds.has(row.id) ? "正在恢复…" : "取消归档"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
