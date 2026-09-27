import { Tray, Menu, app } from 'electron';
import type { NativeImage } from 'electron';
import { CONFIG } from './config';
import { tr } from './i18n';
import type { WindowManager } from './window';
import type { UpdateWindowManager } from './update-window';

export class TrayManager {
  private tray: Tray | null = null;
  private readonly windowManager: WindowManager;
  private readonly updateWindowManager: UpdateWindowManager;

  constructor(windowManager: WindowManager, updateWindowManager: UpdateWindowManager) {
    this.tray = null;
    this.windowManager = windowManager;
    this.updateWindowManager = updateWindowManager;
  }

  init(icon: string | NativeImage | undefined): void {
    if (this.tray || !icon) return;

    try {
      this.tray = new Tray(icon);
      this.tray.setToolTip(CONFIG.appName);

      this.tray.on('click', () => {
        this.windowManager.focus();
      });

      this.tray.on('double-click', () => {
        this.windowManager.focus();
      });

      this.updateContextMenu();
    } catch (err) {
      console.error('[Tray] 初始化托盘失败:', err);
    }
  }

  updateContextMenu() {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: tr('tray.open'),
        click: () => this.windowManager.focus(),
      },
      {
        label: tr('tray.checkUpdates'),
        click: () => {
          if (this.updateWindowManager) {
            this.updateWindowManager.open();
          }
        },
      },
      { type: 'separator' },
      {
        label: tr('tray.quit'),
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
