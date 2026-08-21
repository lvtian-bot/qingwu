import { app, Menu, shell } from 'electron';
import { CONFIG } from './config.js';
import { settings } from './settings.js';

export function createApplicationMenu(options = {}) {
  const { onCheckForUpdates, getTargetWebContents, getMainWindow } = options;

  const buildAndSetMenu = () => {
    const template = [
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
      },
      {
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

  settings.onChange((key) => {
    if (key === 'closeToTray') {
      buildAndSetMenu();
    }
  });

  return buildAndSetMenu();
}
