/**
 * 右侧面板的每会话布局状态（对齐官方 sidebar-right 的存储语义）：
 * 打开的页、选中页、呈现方式与宽度按会话 id 存 localStorage，刷新与切会话恢复。
 * 无效数据只丢弃对应会话的记录，不影响其他会话。
 */
export type PanelTab =
  | { id: "guide"; kind: "guide" }
  | { id: "files"; kind: "files" }
  | { id: string; kind: "preview"; path: string };

export interface PanelLayout {
  expanded: boolean;
  /** 普通贴靠（会话区让位）或覆盖窗口的全屏形态；窄窗下强制全屏由渲染时判定。 */
  fullscreen: boolean;
  width: number;
  tabs: PanelTab[];
  activeTabId: string | null;
}

export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 600;
export const PANEL_DEFAULT_WIDTH = 300;

const storageKeyOf = (sessionId: string) => `qingwu.panel.layout.${sessionId}`;

export function defaultPanelLayout(): PanelLayout {
  return {
    expanded: false,
    fullscreen: false,
    width: PANEL_DEFAULT_WIDTH,
    tabs: [],
    activeTabId: null,
  };
}

function isPanelTab(value: unknown): value is PanelTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  if (tab.kind === "guide") return tab.id === "guide";
  if (tab.kind === "files") return tab.id === "files";
  if (tab.kind === "preview")
    return typeof tab.id === "string" && typeof tab.path === "string";
  return false;
}

export function loadPanelLayout(sessionId: string | null): PanelLayout {
  if (!sessionId) return defaultPanelLayout();
  try {
    const raw = window.localStorage.getItem(storageKeyOf(sessionId));
    if (!raw) return defaultPanelLayout();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") throw new Error("bad layout");
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isPanelTab) : [];
    const activeTabId =
      typeof parsed.activeTabId === "string" &&
      tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs[tabs.length - 1]?.id ?? null);
    return {
      expanded: parsed.expanded === true,
      fullscreen: parsed.fullscreen === true,
      width: Math.min(
        PANEL_MAX_WIDTH,
        Math.max(
          PANEL_MIN_WIDTH,
          typeof parsed.width === "number" && Number.isFinite(parsed.width)
            ? Math.round(parsed.width)
            : PANEL_DEFAULT_WIDTH,
        ),
      ),
      tabs,
      activeTabId,
    };
  } catch {
    try {
      window.localStorage.removeItem(storageKeyOf(sessionId));
    } catch {
      // localStorage 不可用时忽略
    }
    return defaultPanelLayout();
  }
}

export function savePanelLayout(sessionId: string, layout: PanelLayout): void {
  try {
    window.localStorage.setItem(storageKeyOf(sessionId), JSON.stringify(layout));
  } catch {
    // 存储失败时当前布局仍可在内存中使用
  }
}
