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

/**
 * preload 暴露给渲染层的桥接 API。
 * 主进程、preload、渲染层共同以此为准，避免 IPC 契约漂移。
 */
export interface QingwuApi {
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
  getUpdateState: () => Promise<UpdateState | null>;
  checkForUpdates: () => Promise<UpdateState | null>;
  downloadUpdate: () => Promise<UpdateState | null>;
  installUpdate: () => Promise<boolean>;
  openReleases: () => Promise<void>;
  popupMenu: (options: { menuName: string; x: number; y: number }) => Promise<void>;
  getTitle: () => Promise<string>;
  onTitleChanged: (listener: (title: string) => void) => () => void;
  onMenuClosed: (listener: () => void) => () => void;
  onFullscreenChanged: (listener: (isFullScreen: boolean) => void) => () => void;

  /** 调用引擎一元 RPC（POST /api/<endpoint>，如 'session/list'），主进程铸造 rpcId 并包信封。 */
  dshCall: (endpoint: string, payload: unknown) => Promise<DshRpcResult<unknown>>;
  /** 在 remote.mux 上打开一条逻辑流（如 '$events'、'session/follow'），返回 streamId。 */
  dshStreamOpen: (endpoint: string, payload: unknown) => Promise<string>;
  /** 取消一条逻辑流。 */
  dshStreamCancel: (streamId: string) => void;
  /** 订阅逻辑流下行项（item/error/end 统一投递），返回取消函数。 */
  onDshStreamItem: (listener: (item: DshStreamItem) => void) => () => void;
  /** 回应 $events 瀑布事件（审批/问答，POST /api/$events/result）。 */
  dshEventResult: (clientId: string, eventId: string, outcome: unknown) => Promise<void>;

  getUiMode: () => Promise<UiMode>;
  setUiMode: (mode: UiMode) => Promise<void>;
  onUiModeChanged: (listener: (mode: UiMode) => void) => () => void;
}
