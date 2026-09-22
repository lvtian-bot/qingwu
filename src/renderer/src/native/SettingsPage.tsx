import { useEffect, useState, type ReactNode } from "react";
import {
  type ModelCatalog,
  type SessionSummary,
  type WorkspaceView,
} from "./protocol";
import type { PanelWidth } from "./usePanelWidth";
import { useDshSettings } from "./useDshSettings";
import { ModelsTab } from "./ModelsTab";
import { GeneralTab } from "./GeneralTab";
import { ArchivedSessionsTab } from "./ArchivedSessionsTab";
import { PermissionsTab } from "./PermissionsTab";

export interface SettingsPageProps {
  onBack: () => void;
  /** 侧栏宽度控制器：与主界面侧栏共用同一实例，宽度与拖拽互相联动。 */
  sidebarPanel: PanelWidth;
  modelCatalog?: ModelCatalog | null;
  /** 凭据变化后刷新引擎模型目录（供应商注册与模型清单随之更新）。 */
  onRefreshCatalog?: () => void;
  dshConnected?: boolean;
  reconnecting?: boolean;
  onReconnect?: () => void;
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
}

type TabKey = "models" | "general" | "archivedSessions" | "permissions";

const NAV_GROUPS: {
  title: string;
  items: { key: TabKey; label: string; icon: ReactNode }[];
}[] = [
  {
    title: "基础设置",
    items: [
      {
        key: "general",
        label: "常规",
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM9.75 8a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z" />
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.185 1.184l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.185l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
          </svg>
        ),
      },
      {
        key: "models",
        label: "模型设置",
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H2.5A1.5 1.5 0 0 0 1 4.5v9A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 3H11v-.5A1.5 1.5 0 0 0 9.5 1h-3zm0 1h3a.5.5 0 0 1 .5.5V3H6v-.5a.5.5 0 0 1 .5-.5zM2 4.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V6H2V4.5zM2 7h12v6.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V7z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Agent 能力",
    items: [
      {
        key: "permissions",
        label: "权限",
        icon: (
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
            <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" />
            <circle
              cx="8"
              cy="10.5"
              r="0.75"
              fill="currentColor"
              stroke="none"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: "已归档",
    items: [
      {
        key: "archivedSessions",
        label: "已归档会话",
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1V2zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5H2zm13-3H1v2h14V2zM5 7.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z" />
          </svg>
        ),
      },
    ],
  },
];

/**
 * 设置页壳：导航与分区切换。四个分区保持挂载、仅切换可见，
 * 避免切换分区时丢失未保存的输入（如密钥草稿、搜索词）。
 */
export function SettingsPage({
  onBack,
  sidebarPanel,
  modelCatalog,
  onRefreshCatalog,
  dshConnected,
  reconnecting,
  onReconnect,
  sessions,
  workspaces,
  archivedSessionIds,
  onUnarchiveSession,
  onOpenSession,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const dsh = useDshSettings();

  // 按 Esc 键返回应用
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  // 模型与权限整页写入引擎配置目录，展示存储横幅；常规与已归档会话页不展示
  const showDshBanner = activeTab === "models" || activeTab === "permissions";

  const panelStyle = (key: TabKey) =>
    activeTab === key ? undefined : ({ display: "none" } as const);

  return (
    <div className="native-settings-page" aria-label="设置">
      {/* 左侧：返回应用 + 分类导航（复用主界面侧栏框架与同一宽度状态） */}
      <aside
        className="native-sidebar native-settings-rail"
        style={{ width: sidebarPanel.width }}
      >
        <button
          type="button"
          className="native-settings-back-btn"
          onClick={onBack}
          title="返回应用 (Esc)"
        >
          <span className="native-settings-nav-icon">
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 8H2M6.5 3.5L2 8l4.5 4.5" />
            </svg>
          </span>
          <span>返回应用</span>
        </button>

        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="native-sidebar-section">
            <div className="native-sidebar-section-header">
              <span className="native-sidebar-section-title">
                {group.title}
              </span>
            </div>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`native-settings-nav-item ${
                  activeTab === item.key ? "active" : ""
                }`}
                onClick={() => setActiveTab(item.key)}
              >
                <span className="native-settings-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* 侧栏与内容面板之间的拖拽条：与主界面侧栏同一实现 */}
      <div
        className="native-resizer"
        role="separator"
        aria-orientation="vertical"
        title="拖动调节宽度，双击复位"
        onPointerDown={(e) => sidebarPanel.startDrag(e, 1)}
        onDoubleClick={sidebarPanel.reset}
      />

      {/* 右侧：分区内容（复用主界面会话面板外观） */}
      <main className="native-chat native-settings-content">
        {dshConnected === false && (
          <div className="native-connection-banner" role="alert">
            <span className="native-connection-icon">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </span>
            <span className="native-connection-text">
              与 DeepSeek Harness 引擎连接中断，正在尝试重新连接…
            </span>
            <button
              type="button"
              className="native-connection-retry-btn"
              disabled={reconnecting}
              onClick={onReconnect}
            >
              {reconnecting ? "正在重连…" : "立即重试"}
            </button>
          </div>
        )}

        {/* 存储位置透明度横幅：仅覆盖整页写入引擎配置的分区 */}
        {showDshBanner && (
          <div className="native-settings-storage-banner">
            <div className="native-settings-storage-icon">
              <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="currentColor"
              >
                <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm1 12H7V7h2v5zm0-6H7V4h2v2z" />
              </svg>
            </div>
            <div className="native-settings-storage-desc">
              <strong>存储位置：DSH 引擎配置目录 (~/.dsh)</strong>
              <span>
                此分区配置直接写入底层引擎并与 DeepSeek
                界面共享互通，后续官方推出桌面版时可直接继承。
              </span>
            </div>
          </div>
        )}

        {/* 模型设置 */}
        <div className="native-settings-panel" style={panelStyle("models")}>
          <ModelsTab
            modelCatalog={modelCatalog}
            onRefreshCatalog={onRefreshCatalog}
            dsh={dsh}
          />
        </div>

        {/* 常规 */}
        <div className="native-settings-panel" style={panelStyle("general")}>
          <GeneralTab dsh={dsh} />
        </div>

        {/* 已归档会话 */}
        <div
          className="native-settings-panel"
          style={panelStyle("archivedSessions")}
        >
          <ArchivedSessionsTab
            sessions={sessions}
            workspaces={workspaces}
            archivedSessionIds={archivedSessionIds}
            onUnarchiveSession={onUnarchiveSession}
            onOpenSession={onOpenSession}
            dsh={dsh}
          />
        </div>

        {/* 权限 */}
        <div
          className="native-settings-panel"
          style={panelStyle("permissions")}
        >
          <PermissionsTab dsh={dsh} />
        </div>
      </main>
    </div>
  );
}
