import { BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { UpdateState } from '../shared/types';

export class UpdateWindowManager {
  private readonly getParentWindow: () => BrowserWindow | null;
  private window: BrowserWindow | null = null;

  constructor(getParentWindow: () => BrowserWindow | null) {
    this.getParentWindow = getParentWindow;
  }

  open(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      return;
    }

    const parent = this.getParentWindow();
    const win = new BrowserWindow({
      title: '检查更新',
      width: 440,
      height: 400,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.window = win;

    win.setMenu(null);
    win.once('ready-to-show', () => {
      win.show();
    });
    win.on('closed', () => {
      if (this.window === win) {
        this.window = null;
      }
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=update`);
    } else {
      win.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { view: 'update' },
      });
    }
  }

  sendState(state: UpdateState): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('update:state-changed', state);
    }
  }

  isSender(event: IpcMainInvokeEvent): boolean {
    return (
      !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents
    );
  }
}
