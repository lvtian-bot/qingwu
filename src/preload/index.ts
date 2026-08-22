import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { DshStreamFrame, QingwuApi, UiMode, UpdateState } from '../shared/types';

const api: QingwuApi = {
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

  popupMenu: ({ menuName, x, y }) => ipcRenderer.invoke('titlebar:popupMenu', { menuName, x, y }),
  getTitle: () => ipcRenderer.invoke('titlebar:getTitle'),
  onTitleChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, title: string) => listener(title);
    ipcRenderer.on('titlebar:title-changed', handler);
    return () => ipcRenderer.removeListener('titlebar:title-changed', handler);
  },
  onMenuClosed: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('titlebar:menu-closed', handler);
    return () => ipcRenderer.removeListener('titlebar:menu-closed', handler);
  },
  onFullscreenChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, isFullScreen: boolean) =>
      listener(isFullScreen);
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },

  dshCall: (method, payload) => ipcRenderer.invoke('dsh:call', method, payload),
  dshRespond: (rpcId, result) => ipcRenderer.invoke('dsh:respond', rpcId, result),
  onDshEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, frame: DshStreamFrame) => listener(frame);
    ipcRenderer.on('dsh:event', handler);
    return () => ipcRenderer.removeListener('dsh:event', handler);
  },

  getUiMode: () => ipcRenderer.invoke('ui:getMode'),
  setUiMode: (mode) => ipcRenderer.invoke('ui:setMode', mode),
  onUiModeChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, mode: UiMode) => listener(mode);
    ipcRenderer.on('ui:mode-changed', handler);
    return () => ipcRenderer.removeListener('ui:mode-changed', handler);
  },
};

contextBridge.exposeInMainWorld('qingwu', api);
