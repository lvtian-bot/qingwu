import { app, dialog, ipcMain, shell } from 'electron';
import { HarnessManager } from './harness.js';
import { WindowManager } from './window.js';
import { createApplicationMenu } from './menu.js';
import { setupAboutPanel } from './about.js';
import { UpdateService } from './update.js';
import { UpdateWindowManager } from './update-window.js';
import { CONFIG } from './config.js';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] 已有应用实例正在运行，退出当前进程');
  app.quit();
} else {
  const windowManager = new WindowManager();
  const harnessManager = new HarnessManager();
  const updateService = new UpdateService();
  const updateWindowManager = new UpdateWindowManager(() => windowManager.mainWindow);

  updateService.onStateChange = (state) => updateWindowManager.sendState(state);

  app.on('second-instance', () => {
    windowManager.focus();
  });

  const isUpdateWindowSender = (event) => updateWindowManager.isSender(event);

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

  app.whenReady().then(async () => {
    try {
      console.log('[Main] 青梧应用启动中...');
      setupAboutPanel();

      await harnessManager.start();

      const serviceUrl = harnessManager.getServiceUrl();
      windowManager.createWindow(serviceUrl);

      createApplicationMenu({
        onCheckForUpdates: () => updateWindowManager.open(),
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
        `无法启动内置引擎服务:\n${err.message || err}\n\n应用即将退出。`
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', async (event) => {
    console.log('[Main] 正在退出应用，清理子进程...');
    await harnessManager.stop();
  });
}
