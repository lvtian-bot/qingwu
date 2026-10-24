/**
 * 右侧面板的每会话布局状态（对齐官方 sidebar-right 的存储语义）：
 * 打开的页、选中页、呈现方式与宽度按会话 id 存 localStorage，刷新与切会话恢复。
 * 无效数据只丢弃对应会话的记录，不影响其他会话。
 */
export type PanelTab =
  | { id: string; kind: "guide" }
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

/** 面板内的行号跳转指令：openFile 携带行号时发出，预览页按 seq 变化执行定位。 */
export interface PanelJump {
  path: string;
  line: number;
  seq: number;
}

export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_DEFAULT_WIDTH = 600;
export const PANEL_WIDTH_KEY = "qingwu.panel.width";

const storageKeyOf = (sessionId: string) => `qingwu.panel.layout.${sessionId}`;

/**
 * 读取全局统一的面板宽度（对齐官方 DSH 与成熟桌面标杆）：
 * 宽度属于全局桌面视口容器属性，跨会话统一保持；老旧 500px 默认值平滑抬升至 600px。
 */
export function loadPanelWidth(): number {
  try {
    const raw =
      window.localStorage.getItem(PANEL_WIDTH_KEY) ??
      window.localStorage.getItem("qingwu.panel.lastWidth");
    if (!raw) return PANEL_DEFAULT_WIDTH;
    const val = Number(raw);
    if (Number.isFinite(val) && val >= PANEL_MIN_WIDTH && val <= PANEL_MAX_WIDTH) {
      return val === 500 ? PANEL_DEFAULT_WIDTH : Math.round(val);
    }
  } catch {
    // localStorage 不可用时回退
  }
  return PANEL_DEFAULT_WIDTH;
}

/** 持久化全局面板宽度（拖拽释放或双击重置时写入）。 */
export function savePanelWidth(width: number): void {
  try {
    const clamped = Math.min(
      PANEL_MAX_WIDTH,
      Math.max(PANEL_MIN_WIDTH, Math.round(width)),
    );
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
  } catch {
    // 存储失败时忽略
  }
}

export function defaultPanelLayout(): PanelLayout {
  return {
    expanded: false,
    fullscreen: false,
    width: loadPanelWidth(),
    tabs: [],
    activeTabId: null,
  };
}

function isPanelTab(value: unknown): value is PanelTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  if (tab.kind === "guide") return typeof tab.id === "string" && tab.id.length > 0;
  if (tab.kind === "files") return tab.id === "files";
  if (tab.kind === "preview")
    return typeof tab.id === "string" && typeof tab.path === "string";
  return false;
}

export function loadPanelLayout(sessionId: string | null): PanelLayout {
  let width = loadPanelWidth();
  if (!sessionId) return { ...defaultPanelLayout(), width };
  try {
    const raw = window.localStorage.getItem(storageKeyOf(sessionId));
    if (!raw) return { ...defaultPanelLayout(), width };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") throw new Error("bad layout");
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isPanelTab) : [];
    const activeTabId =
      typeof parsed.activeTabId === "string" &&
      tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs[tabs.length - 1]?.id ?? null);

    // 平滑迁移：若全局宽度尚无记录，且老会话保存了非 500 的自定义有效宽度，平滑提升为全局宽度
    const hasGlobalRecord =
      window.localStorage.getItem(PANEL_WIDTH_KEY) !== null ||
      window.localStorage.getItem("qingwu.panel.lastWidth") !== null;
    if (
      !hasGlobalRecord &&
      typeof parsed.width === "number" &&
      Number.isFinite(parsed.width)
    ) {
      const legacyWidth = Math.round(parsed.width);
      if (
        legacyWidth !== 500 &&
        legacyWidth >= PANEL_MIN_WIDTH &&
        legacyWidth <= PANEL_MAX_WIDTH
      ) {
        savePanelWidth(legacyWidth);
        width = legacyWidth;
      }
    }

    return {
      expanded: parsed.expanded === true,
      fullscreen: parsed.fullscreen === true,
      width,
      tabs,
      activeTabId,
    };
  } catch {
    try {
      window.localStorage.removeItem(storageKeyOf(sessionId));
    } catch {
      // localStorage 不可用时忽略
    }
    return { ...defaultPanelLayout(), width };
  }
}

export function savePanelLayout(sessionId: string, layout: PanelLayout): void {
  try {
    window.localStorage.setItem(storageKeyOf(sessionId), JSON.stringify(layout));
  } catch {
    // 存储失败时当前布局仍可在内存中使用
  }
}
