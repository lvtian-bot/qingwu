import { BrowserWindow } from 'electron';
import path from 'node:path';

export class UpdateWindowManager {
  constructor(getParentWindow) {
    this.getParentWindow = getParentWindow;
    this.window = null;
  }

  open() {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      return;
    }

    const parent = this.getParentWindow();
    this.window = new BrowserWindow({
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

    this.window.setMenu(null);
    this.window.once('ready-to-show', () => {
      this.window?.show();
    });
    this.window.on('closed', () => {
      this.window = null;
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      this.window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=update`);
    } else {
      this.window.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { view: 'update' },
      });
    }
  }

  sendState(state) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('update:state-changed', state);
    }
  }

  isSender(event) {
    return (
      !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents
    );
  }
}
