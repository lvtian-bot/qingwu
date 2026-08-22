import { app, dialog, ipcMain, Menu, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { acquireHiddenConsole } from './console';
import { HarnessManager } from './harness';
import { WindowManager } from './window';
import { createApplicationMenu } from './menu';
import { setupAboutPanel } from './about';
import { UpdateService } from './update';
import { UpdateWindowManager } from './update-window';
import { TrayManager } from './tray';
import { CONFIG } from './config';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] 已有应用实例正在运行，退出当前进程');
  app.quit();
} else {
  acquireHiddenConsole();
  app.setAppUserModelId(CONFIG.appId || 'com.qingwu.desktop');
  const windowManager = new WindowManager();
  const harnessManager = new HarnessManager();
  const updateService = new UpdateService();
  const updateWindowManager = new UpdateWindowManager(() => windowManager.mainWindow);
  const trayManager = new TrayManager(windowManager, updateWindowManager);

  updateService.onStateChange = (state) => updateWindowManager.sendState(state);

  app.on('second-instance', () => {
    windowManager.focus();
  });

  const isUpdateWindowSender = (event: IpcMainInvokeEvent) =>
    updateWindowManager.isSender(event);

  ipcMain.handle('update:getState', (event) =>
    isUpdateWindowSender(event) ? updateService.getState() : null
  );
  ipcMain.handle('update:check', (event) =>
    isUpdateWindowSender(event) ? updateService.check() : null
  );
  ipcMain.handle('update:download', (event) =>
    isUpdateWindowSender(event) ? updateService.download() : null
  );
  ipcMain.handle('update:install', (event) =>
    isUpdateWindowSender(event) ? updateService.install() : false
  );
  ipcMain.handle('update:openReleases', (event) => {
    if (isUpdateWindowSender(event)) {
      shell.openExternal(CONFIG.repositoryUrl + '/releases');
    }
  });

  ipcMain.handle('titlebar:popupMenu', (_event, { menuName, x, y }) => {
    const win = windowManager.mainWindow;
    if (!win || win.isDestroyed()) return;

    const appMenu = Menu.getApplicationMenu();
    if (!appMenu) return;

    const targetItem = appMenu.items.find((item) => item.label === menuName);
    if (!targetItem || !targetItem.submenu) return;

    targetItem.submenu.popup({
      window: win,
      x: Math.round(x),
      y: Math.round(y),
      callback: () => {
        if (!win.isDestroyed()) {
          win.webContents.send('titlebar:menu-closed');
        }
      },
    });
  });

  ipcMain.handle('titlebar:getTitle', () => {
    return windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()
      ? windowManager.mainWindow.getTitle()
      : CONFIG.appName;
  });

  app.whenReady().then(async () => {
    try {
      console.log('[Main] 青梧应用启动中...');
      setupAboutPanel();

      await harnessManager.start();

      const serviceUrl = harnessManager.getServiceUrl();
      windowManager.createWindow(serviceUrl);

      const iconPath = windowManager.getIconPath();
      if (iconPath) {
        trayManager.init(iconPath);
      }

      createApplicationMenu({
        onCheckForUpdates: () => updateWindowManager.open(),
        getTargetWebContents: () => windowManager.getTargetWebContents(),
        getMainWindow: () => windowManager.mainWindow,
      });

      harnessManager.onUnexpectedExit((code, signal) => {
        console.error(`[Main] 引擎异常退出: code=${code}, signal=${signal}`);
        windowManager.showErrorMessage(
          '服务连接已中断',
          `后台引擎服务异常退出 (退出码: ${code || '无'}, 信号: ${signal || '无'})。请尝试重启应用或重新连接。`
        );
      });
    } catch (err) {
      console.error('[Main] 启动失败:', err);
      dialog.showErrorBox(
        '青梧启动失败',
        `无法启动内置引擎服务:\n${err instanceof Error ? err.message : String(err)}\n\n应用即将退出。`
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', async (_event) => {
    windowManager.isQuitting = true;
    trayManager.destroy();
    console.log('[Main] 正在退出应用，清理子进程...');
    await harnessManager.stop();
  });
}
