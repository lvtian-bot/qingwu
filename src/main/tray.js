import { Tray, Menu, app } from 'electron';
import { CONFIG } from './config.js';
import { settings } from './settings.js';

export class TrayManager {
  constructor(windowManager, updateWindowManager) {
    this.tray = null;
    this.windowManager = windowManager;
    this.updateWindowManager = updateWindowManager;
    this.unsubscribeSettings = null;
  }

  init(iconPath) {
    if (this.tray || !iconPath) return;

    try {
      this.tray = new Tray(iconPath);
      this.tray.setToolTip(CONFIG.appName);

      this.tray.on('click', () => {
        this.windowManager.focus();
      });

      this.tray.on('double-click', () => {
        this.windowManager.focus();
      });

      this.updateContextMenu();

      this.unsubscribeSettings = settings.onChange((key) => {
        if (key === 'closeToTray') {
          this.updateContextMenu();
        }
      });
    } catch (err) {
      console.error('[Tray] 初始化托盘失败:', err);
    }
  }

  updateContextMenu() {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '打开青梧',
        click: () => this.windowManager.focus(),
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
      {
        label: '检查更新...',
        click: () => {
          if (this.updateWindowManager) {
            this.updateWindowManager.open();
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  destroy() {
    if (this.unsubscribeSettings) {
      this.unsubscribeSettings();
      this.unsubscribeSettings = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
