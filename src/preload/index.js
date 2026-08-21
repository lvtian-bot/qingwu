import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qingwu', {
  onUpdateState: (listener) => {
    const handler = (_event, state) => listener(state);
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
    const handler = (_event, title) => listener(title);
    ipcRenderer.on('titlebar:title-changed', handler);
    return () => ipcRenderer.removeListener('titlebar:title-changed', handler);
  },
  onMenuClosed: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('titlebar:menu-closed', handler);
    return () => ipcRenderer.removeListener('titlebar:menu-closed', handler);
  },
  onFullscreenChanged: (listener) => {
    const handler = (_event, isFullScreen) => listener(isFullScreen);
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },
});
