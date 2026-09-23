import type { MenuName, MenuStateContext } from "./menu-data";

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

/** 界面模式：official = 官方 dsh web UI，native = 自研界面。 */
export type UiMode = 'official' | 'native';

/** 聊天区内容列宽档位：narrow 紧凑（默认，与 DeepSeek 界面一致）、medium 适中、wide 宽敞。 */
export type ChatWidth = 'narrow' | 'medium' | 'wide';

export const CHAT_WIDTHS: readonly ChatWidth[] = ['narrow', 'medium', 'wide'];

/** 青梧应用级本地配置（存储于用户数据目录 settings.json）。 */
export interface AppSettings {
  /** 窗口关闭行为：true 为最小化到托盘，false 为直接退出。 */
  closeToTray: boolean;
  /** 默认启动界面。 */
  uiMode: UiMode;
  /** 是否折叠回合执行过程与工具调用（默认 false：不折叠与 DeepSeek 保持一致；开启时折叠为单行摘要）。 */
  collapseProcess?: boolean;
  /** 聊天区内容列宽档位（默认 narrow 紧凑，与 DeepSeek 界面保持一致）。 */
  chatWidth?: ChatWidth;
}

/** dsh RPC 业务错误（对齐 typert RemoteError 的线上形态）。 */
export interface DshRpcError {
  code: string;
  message: string;
  details?: unknown;
}

/** dsh RPC 结果（对齐 typert RemoteResult）。 */
export type DshRpcResult<T> = { ok: true; value: T } | { ok: false; error: DshRpcError };

/** 引擎逻辑流下行项：remote.mux 复用流的 item 值，按 endpoint 判别帧协议。 */
export interface DshStreamItem {
  streamId: string;
  endpoint: string;
  value: unknown;
}

/** 渲染层未捕获错误的原始结构；主进程负责裁剪和脱敏后落盘。 */
export interface RendererErrorReport {
  kind: "react-render" | "window-error" | "unhandled-rejection";
  message: string;
  stack?: string;
  componentStack?: string;
  source?: string;
  line?: number;
  column?: number;
}

/**
 * preload 暴露给渲染层的桥接 API。
 * 主进程、preload、渲染层共同以此为准，避免 IPC 契约漂移。
 */
export interface QingwuApi {
  /** 将青梧界面的未捕获错误交给主进程脱敏落盘。 */
  reportRendererError: (report: RendererErrorReport) => void;
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
  getUpdateState: () => Promise<UpdateState | null>;
  checkForUpdates: () => Promise<UpdateState | null>;
  downloadUpdate: () => Promise<UpdateState | null>;
  installUpdate: () => Promise<boolean>;
  openReleases: () => Promise<void>;
  openUpdateWindow: () => Promise<void>;
  showAbout: () => Promise<void>;
  /** 在主进程透明子窗口中打开自绘菜单弹层（坐标为主窗口内容区相对位置）；viaSwitch 表示悬停/方向键穿梭，原位换内容不重放入场动画。 */
  openMenuPopup: (options: {
    menuName: string;
    x: number;
    y: number;
    viaSwitch?: boolean;
  }) => Promise<void>;
  /** 左右方向键在顶级菜单间穿梭，由标题栏重测目标按钮位置。 */
  switchMenuPopup: (direction: "left" | "right") => Promise<void>;
  closeMenuPopup: () => Promise<void>;
  executeMenuAction: (actionId: string) => Promise<void>;
  menuPopupReady: () => Promise<void>;
  /** 弹层渲染层实测菜单 DOM 宽高回报（带菜单名），主进程据此收紧弹窗并按菜单缓存尺寸供下次打开预置。 */
  resizeMenuPopup: (size: {
    width: number;
    height: number;
    menuName: MenuName;
    sessionId: number;
  }) => Promise<void>;
  onMenuPopupData: (
    listener: (data: {
      menuName: MenuName;
      /** 打开会话号：仅新打开递增，穿梭切换不变；渲染层以此重放入场动画。 */
      sessionId: number;
      context: MenuStateContext;
      maxWidth: number;
      maxHeight: number;
      /** null = 弹层已关闭：渲染层清空内容，保证隐藏窗口不留旧帧。 */
    } | null) => void
  ) => () => void;
  getTitle: () => Promise<string>;
  onTitleChanged: (listener: (title: string) => void) => () => void;
  /** 请求标题栏同步目标菜单高亮并回报其坐标。 */
  onMenuSwitch: (listener: (menuName: MenuName) => void) => () => void;
  /** 菜单关闭：失焦关闭不抢焦点，显式关闭恢复当前界面焦点。 */
  onMenuClosed: (listener: (reason: "blur" | "explicit") => void) => () => void;
  onFullscreenChanged: (listener: (isFullScreen: boolean) => void) => () => void;
  /** 菜单动作「设置」：主进程通知青梧界面打开设置页。 */
  onOpenSettings: (listener: () => void) => () => void;

  /** 调用引擎一元 RPC（POST /api/<endpoint>，如 'session/list'），主进程铸造 rpcId 并包信封。 */
  dshCall: (endpoint: string, payload: unknown) => Promise<DshRpcResult<unknown>>;
  /** 在 remote.mux 上打开一条逻辑流（如 '$events'、'session/follow'），返回 streamId。 */
  dshStreamOpen: (endpoint: string, payload: unknown) => Promise<string>;
  /** 取消一条逻辑流。 */
  dshStreamCancel: (streamId: string) => void;
  /** 订阅逻辑流下行项（item/error/end 统一投递），返回取消函数。 */
  onDshStreamItem: (listener: (item: DshStreamItem) => void) => () => void;
  /** 回应 $events 瀑布事件（审批/问答，POST /api/$events/result）；失败以 RemoteResult 形态回传，调用方必须处理。 */
  dshEventResult: (
    clientId: string,
    eventId: string,
    outcome: unknown
  ) => Promise<DshRpcResult<unknown>>;

  /** 查询当前引擎通信连接状态。 */
  getDshConnectionStatus: () => Promise<boolean>;
  /** 主动请求重新连接引擎。 */
  reconnectDsh: () => Promise<void>;
  /** 订阅引擎连接状态变化（connected: true 为已连通，false 为断连）。 */
  onDshConnectionChanged: (listener: (connected: boolean) => void) => () => void;

  getUiMode: () => Promise<UiMode>;
  setUiMode: (mode: UiMode) => Promise<void>;
  onUiModeChanged: (listener: (mode: UiMode) => void) => () => void;

  /** 获取青梧本地应用设置。 */
  getAppSettings: () => Promise<AppSettings>;
  /** 更新青梧本地应用设置。 */
  setAppSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  /** 订阅青梧本地应用设置变更。 */
  onAppSettingsChanged: (listener: (settings: AppSettings) => void) => () => void;
  /** 在文件管理器中打开青梧本地应用数据目录。 */
  openUserDataFolder: () => Promise<string>;

  /** 在外部终端中打开指定路径（若未传则打开当前活跃工作区）。 */
  openTerminal: (targetPath?: string) => Promise<{ success: boolean; error?: string }>;
  /** 在系统文件管理器中打开指定路径（若为文件则用系统默认程序打开）。 */
  openPath: (targetPath: string) => Promise<string>;
  /** 在文件管理器中高亮定位指定文件或目录。 */
  showItemInFolder: (targetPath: string) => Promise<void>;
  /** 通知主进程当前活跃的工作区路径，以便全局菜单与快捷键呼出。 */
  setActiveWorkspacePath: (targetPath: string | null) => void;
}
