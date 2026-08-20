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
});
