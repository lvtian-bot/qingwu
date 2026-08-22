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

/** dsh RPC 业务错误（对齐 apiproxy RpcError 的最小形态）。 */
export interface DshRpcError {
  code: string;
  message: string;
  details?: unknown;
}

/** dsh RPC 结果（对齐 apiproxy RpcResult）。 */
export type DshRpcResult<T> = { ok: true; value: T } | { ok: false; error: DshRpcError };

/** dsh respond 调用的回执（对齐 apiproxy RpcReceipt）。 */
export type DshRpcReceipt = { accepted: true } | { accepted: false; reason: string };

/**
 * 引擎事件流下行帧：ServerRequest 信封的 payload（MuxFrame / HostFrame），
 * 渲染层按 payload.type 判别，协议类型见 src/renderer/src/native/protocol.ts。
 */
export interface DshStreamFrame {
  stream: 'mux' | 'host';
  rpcId: string;
  payload: unknown;
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

  /** 调用引擎 RPC（POST /api/<method>），主进程铸造 rpcId 并包信封。 */
  dshCall: (method: string, payload: unknown) => Promise<DshRpcResult<unknown>>;
  /** 回应引擎下行请求（审批/问答，POST /api/respond），rpcId 必须回显原帧。 */
  dshRespond: (rpcId: string, result: DshRpcResult<unknown>) => Promise<DshRpcReceipt>;
  /** 订阅引擎事件流帧（mux + host），返回取消函数。 */
  onDshEvent: (listener: (frame: DshStreamFrame) => void) => () => void;

  getUiMode: () => Promise<UiMode>;
  setUiMode: (mode: UiMode) => Promise<void>;
  onUiModeChanged: (listener: (mode: UiMode) => void) => () => void;
}
