import { app, ipcMain, Menu, shell } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import { CONFIG } from './config';
import { settings } from './settings';

export interface ApplicationMenuOptions {
  onCheckForUpdates?: () => void;
  getTargetWebContents?: () => WebContents | null;
  getMainWindow?: () => BrowserWindow | null;
  onSwitchUiMode?: () => void;
}

export function createApplicationMenu(options: ApplicationMenuOptions = {}) {
  const { onCheckForUpdates, getTargetWebContents, getMainWindow, onSwitchUiMode } = options;

  const buildAndSetMenu = () => {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: '文件',
        submenu: [
          {
            label: '重新加载',
            accelerator: 'CmdOrCtrl+R',
            click: () => {
              const wc = getTargetWebContents?.();
              if (wc) wc.reload();
            },
          },
          {
            label: '强制重新加载',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => {
              const wc = getTargetWebContents?.();
              if (wc) wc.reloadIgnoringCache();
            },
          },
          { type: 'separator' },
          {
            label: '关闭时最小化到系统托盘',
            type: 'checkbox',
            checked: Boolean(settings.get('closeToTray')),
            click: (menuItem) => {
              settings.set('closeToTray', menuItem.checked);
            },
          },
          { type: 'separator' },
          {
            label: '退出',
            accelerator: 'Alt+F4',
            role: 'quit',
          },
        ],
      },      {
        label: '编辑',
        submenu: [
          { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
          { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
          { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
          { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
          { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        ],
      },
      {
        label: '视图',
        submenu: [
          {
            label: '放大',
            accelerator: 'CmdOrCtrl+Plus',
            click: () => {
              const wc = getTargetWebContents?.();
              if (wc) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
            },
          },
          {
            label: '缩小',
            accelerator: 'CmdOrCtrl+-',
            click: () => {
              const wc = getTargetWebContents?.();
              if (wc) wc.setZoomLevel(wc.getZoomLevel() - 0.5);
            },
          },
          {
            label: '重置缩放',
            accelerator: 'CmdOrCtrl+0',
            click: () => {
              const wc = getTargetWebContents?.();
              if (wc) wc.setZoomLevel(0);
            },
          },
          { type: 'separator' },
          {
            label: '切换全屏',
            accelerator: 'F11',
            click: () => {
              const win = getMainWindow?.();
              if (win && !win.isDestroyed()) {
                win.setFullScreen(!win.isFullScreen());
              }
            },
          },
          { type: 'separator' },
          {
            label: settings.get('uiMode') === 'native' ? '切换到 DeepSeek 界面' : '切换到青梧界面',
            click: () => {
              onSwitchUiMode?.();
            },
          },
          { type: 'separator' },
          {
            label: '开发者工具',
            accelerator: 'F12',
            click: () => {
              const wc = getTargetWebContents?.();
              if (wc) wc.toggleDevTools();
            },
          },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '检查更新',
            click: () => {
              if (typeof onCheckForUpdates === 'function') {
                onCheckForUpdates();
              }
            },
          },
          {
            label: 'GitHub 仓库',
            click: () => {
              shell.openExternal(CONFIG.repositoryUrl);
            },
          },
          {
            label: '关于 青梧',
            click: () => {
              app.showAboutPanel();
            },
          },
        ],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    return menu;
  };

  // popup 回调在 Esc、再点标题栏按钮、焦点移出（含部分点击外部场景）等关闭路径下
  // 不触发（electron#17341 及其在 Windows 上的变体），故由主进程在菜单开启期间
  // 以多个信号兜底通知标题栏“菜单已关闭”；popupOpen 保证信号只在菜单真正
  // 开启时生效，避免打开菜单那次点击自身的 focus 事件误触发。
  let popupOpen = false;
  const sendMenuClosed = () => {
    const win = getMainWindow?.();
    if (win && !win.isDestroyed()) {
      win.webContents.send('titlebar:menu-closed');
    }
  };
  const notifyMenuClosed = () => {
    if (!popupOpen) return;
    popupOpen = false;
    sendMenuClosed();
  };

  // 菜单关闭后点击落点所在视图必然重新获得焦点，作为点击外部关闭的兜底信号。
  getMainWindow?.()?.webContents.on('focus', notifyMenuClosed);
  getTargetWebContents?.()?.on('focus', notifyMenuClosed);

  ipcMain.handle('titlebar:popupMenu', (_event, { menuName, x, y }) => {
    const win = getMainWindow?.();
    if (!win || win.isDestroyed()) return;

    const targetItem = Menu.getApplicationMenu()?.items.find((item) => item.label === menuName);
    if (!targetItem || !targetItem.submenu) return;

    popupOpen = true;
    // 菜单开启期间点击其他应用时 callback 与 focus 兜底都不触发，以窗口 blur 为关闭信号。
    const onWindowBlur = notifyMenuClosed;
    win.once('blur', onWindowBlur);

    targetItem.submenu.popup({
      window: win,
      x: Math.round(x),
      y: Math.round(y),
      callback: () => {
        const wasOpen = popupOpen;
        popupOpen = false;
        win.removeListener('blur', onWindowBlur);
        if (wasOpen) sendMenuClosed();
      },
    });
  });

  settings.onChange((key) => {
    if (key === 'closeToTray' || key === 'uiMode') {
      buildAndSetMenu();
    }
  });

  return buildAndSetMenu();
}
