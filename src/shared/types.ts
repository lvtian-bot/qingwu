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
}
