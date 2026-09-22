import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  AppSettings,
  DshStreamItem,
  QingwuApi,
  RendererErrorReport,
  UiMode,
  UpdateState,
} from '../shared/types';

interface PreloadWindowErrorEvent {
  error?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface PreloadUnhandledRejectionEvent {
  reason?: unknown;
}

declare const window: {
  addEventListener(
    type: 'error',
    listener: (event: PreloadWindowErrorEvent) => void,
  ): void;
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: PreloadUnhandledRejectionEvent) => void,
  ): void;
};

function describeThrown(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value) };
  } catch {
    return { message: String(value) };
  }
}

function reportRendererError(report: RendererErrorReport): void {
  ipcRenderer.send('diagnostics:renderer-error', report);
}

window.addEventListener('error', (event) => {
  const described = describeThrown(event.error ?? event.message);
  reportRendererError({
    kind: 'window-error',
    ...described,
    source: event.filename || undefined,
    line: event.lineno || undefined,
    column: event.colno || undefined,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  reportRendererError({
    kind: 'unhandled-rejection',
    ...describeThrown(event.reason),
  });
});

const api: QingwuApi = {
  reportRendererError,
  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on('update:state-changed', handler);
    return () => ipcRenderer.removeListener('update:state-changed', handler);
  },
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openReleases: () => ipcRenderer.invoke('update:openReleases'),
  openUpdateWindow: () => ipcRenderer.invoke('titlebar:openUpdateWindow'),
  showAbout: () => ipcRenderer.invoke('titlebar:showAbout'),

  openMenuPopup: (options) => ipcRenderer.invoke('menu-popup:open', options),
  switchMenuPopup: (direction) => ipcRenderer.invoke('menu-popup:switch', direction),
  closeMenuPopup: () => ipcRenderer.invoke('menu-popup:close'),
  executeMenuAction: (actionId) => ipcRenderer.invoke('menu-popup:action', actionId),
  menuPopupReady: () => ipcRenderer.invoke('menu-popup:ready'),
  resizeMenuPopup: (size) => ipcRenderer.invoke('menu-popup:resize', size),
  onMenuPopupData: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      data: {
        menuName: import('../shared/menu-data').MenuName;
        sessionId: number;
        context: import('../shared/menu-data').MenuStateContext;
      } | null,
    ) => listener(data);
    ipcRenderer.on('menu-popup:data', handler);
    return () => ipcRenderer.removeListener('menu-popup:data', handler);
  },

  getTitle: () => ipcRenderer.invoke('titlebar:getTitle'),
  onTitleChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, title: string) => listener(title);
    ipcRenderer.on('titlebar:title-changed', handler);
    return () => ipcRenderer.removeListener('titlebar:title-changed', handler);
  },
  onMenuClosed: (listener) => {
    const handler = (_event: IpcRendererEvent, reason: 'blur' | 'explicit') =>
      listener(reason);
    ipcRenderer.on('titlebar:menu-closed', handler);
    return () => ipcRenderer.removeListener('titlebar:menu-closed', handler);
  },
  onOpenSettings: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('qingwu:open-settings', handler);
    return () => ipcRenderer.removeListener('qingwu:open-settings', handler);
  },
  onFullscreenChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, isFullScreen: boolean) =>
      listener(isFullScreen);
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },

  dshCall: (endpoint, payload) => ipcRenderer.invoke('dsh:call', endpoint, payload),
  dshStreamOpen: (endpoint, payload) =>
    ipcRenderer.invoke('dsh:stream-open', { endpoint, payload }),
  dshStreamCancel: (streamId) => {
    void ipcRenderer.invoke('dsh:stream-cancel', { streamId });
  },
  onDshStreamItem: (listener) => {
    const handler = (_event: IpcRendererEvent, item: DshStreamItem) => listener(item);
    ipcRenderer.on('dsh:stream-item', handler);
    return () => ipcRenderer.removeListener('dsh:stream-item', handler);
  },
  dshEventResult: (clientId, eventId, outcome) =>
    ipcRenderer.invoke('dsh:event-result', { clientId, eventId, outcome }),

  getDshConnectionStatus: () => ipcRenderer.invoke('dsh:getConnectionStatus'),
  reconnectDsh: () => ipcRenderer.invoke('dsh:reconnect'),
  onDshConnectionChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, connected: boolean) => listener(connected);
    ipcRenderer.on('dsh:connection-status', handler);
    return () => ipcRenderer.removeListener('dsh:connection-status', handler);
  },

  getUiMode: () => ipcRenderer.invoke('ui:getMode'),
  setUiMode: (mode) => ipcRenderer.invoke('ui:setMode', mode),
  onUiModeChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, mode: UiMode) => listener(mode);
    ipcRenderer.on('ui:mode-changed', handler);
    return () => ipcRenderer.removeListener('ui:mode-changed', handler);
  },

  getAppSettings: () => ipcRenderer.invoke('appSettings:get'),
  setAppSettings: (patch) => ipcRenderer.invoke('appSettings:set', patch),
  onAppSettingsChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, updated: AppSettings) => listener(updated);
    ipcRenderer.on('appSettings:changed', handler);
    return () => ipcRenderer.removeListener('appSettings:changed', handler);
  },
  openUserDataFolder: () => ipcRenderer.invoke('appSettings:openUserData'),

  openTerminal: (targetPath) => ipcRenderer.invoke('workspace:openTerminal', targetPath),
  openPath: (targetPath) => ipcRenderer.invoke('workspace:openPath', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('workspace:showItemInFolder', targetPath),
  setActiveWorkspacePath: (targetPath) => {
    void ipcRenderer.invoke('workspace:setActivePath', targetPath);
  },
};

contextBridge.exposeInMainWorld('qingwu', api);
