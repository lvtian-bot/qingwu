import { app, BrowserWindow, WebContentsView, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from './config.js';
import { settings } from './settings.js';

const TITLE_BAR_HEIGHT = 35;

export class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.dshView = null;
    this.isQuitting = false;
    this.serviceUrl = null;
  }

  getIconPath() {
    const possiblePaths = [
      path.join(app.getAppPath(), 'build', 'icon.ico'),
      path.join(app.getAppPath(), 'build', 'icon.png'),
      path.join(process.resourcesPath, 'build', 'icon.ico'),
      path.join(process.resourcesPath, 'build', 'icon.png'),
      path.join(process.cwd(), 'build', 'icon.ico'),
      path.join(process.cwd(), 'build', 'icon.png'),
      path.join(process.cwd(), 'src', 'main', 'assets', 'icon.png'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return undefined;
  }

  createWindow(url) {
    const icon = this.getIconPath();
    this.serviceUrl = url;

    this.mainWindow = new BrowserWindow({
      title: CONFIG.appName,
      width: CONFIG.window.width,
      height: CONFIG.window.height,
      minWidth: CONFIG.window.minWidth,
      minHeight: CONFIG.window.minHeight,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#181818',
        symbolColor: '#999999',
        height: TITLE_BAR_HEIGHT,
      },
      autoHideMenuBar: true,
      show: false,
      icon,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });

    this.mainWindow.setMenuBarVisibility(false);

    this.mainWindow.on('close', (e) => {
      if (!this.isQuitting && settings.get('closeToTray')) {
        e.preventDefault();
        this.mainWindow.hide();
      }
    });

    this.dshView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.mainWindow.contentView.addChildView(this.dshView);

    const updateViewBounds = () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.dshView) return;
      const [width, height] = this.mainWindow.getContentSize();
      const isFullScreen = this.mainWindow.isFullScreen();
      const topOffset = isFullScreen ? 0 : TITLE_BAR_HEIGHT;
      this.dshView.setBounds({
        x: 0,
        y: topOffset,
        width: width,
        height: Math.max(0, height - topOffset),
      });
    };

    this.mainWindow.on('resize', updateViewBounds);
    this.mainWindow.on('maximize', updateViewBounds);
    this.mainWindow.on('unmaximize', updateViewBounds);
    this.mainWindow.on('enter-full-screen', () => {
      updateViewBounds();
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('window:fullscreen-changed', true);
      }
    });
    this.mainWindow.on('leave-full-screen', () => {
      updateViewBounds();
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('window:fullscreen-changed', false);
      }
    });

    this.dshView.webContents.on('page-title-updated', (e, title) => {
      e.preventDefault();
      const displayTitle =
        title && title !== CONFIG.appName ? `${CONFIG.appName} - ${title}` : CONFIG.appName;
      this.mainWindow.setTitle(displayTitle);
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('titlebar:title-changed', displayTitle);
      }
    });

    this.dshView.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (targetUrl.startsWith('http:') || targetUrl.startsWith('https:')) {
        if (!this.serviceUrl || !targetUrl.startsWith(this.serviceUrl)) {
          shell.openExternal(targetUrl);
          return { action: 'deny' };
        }
      }
      return { action: 'allow' };
    });

    this.dshView.webContents.on('will-navigate', (e, targetUrl) => {
      if (this.serviceUrl && !targetUrl.startsWith(this.serviceUrl)) {
        e.preventDefault();
        shell.openExternal(targetUrl);
      }
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      this.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    this.mainWindow.once('ready-to-show', () => {
      updateViewBounds();
      this.mainWindow.show();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      this.dshView = null;
    });

    this.loadUrl(url);
    return this.mainWindow;
  }

  loadUrl(url) {
    this.serviceUrl = url;
    if (this.dshView && !this.dshView.webContents.isDestroyed()) {
      this.dshView.webContents.loadURL(url).catch((err) => {
        console.error('[Window] 加载页面失败:', err);
      });
    }
  }

  getTargetWebContents() {
    if (this.dshView && !this.dshView.webContents.isDestroyed()) {
      return this.dshView.webContents;
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow.webContents;
    }
    return null;
  }

  focus() {
    if (this.mainWindow) {
      if (!this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
      if (this.dshView && !this.dshView.webContents.isDestroyed()) {
        this.dshView.webContents.focus();
      }
    }
  }

  showErrorMessage(title, message) {
    if (this.dshView && !this.dshView.webContents.isDestroyed()) {
      const escapedMsg = message.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const errorHtml = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #0f172a;
              color: #f8fafc;
            }
            .card {
              background: #1e293b;
              border: 1px solid #334155;
              border-radius: 12px;
              padding: 32px;
              max-width: 520px;
              text-align: center;
              box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
            }
            h2 { color: #f43f5e; margin-top: 0; }
            p { color: #94a3b8; line-height: 1.6; }
            button {
              margin-top: 20px;
              padding: 10px 24px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            }
            button:hover { background: #2563eb; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>${title}</h2>
            <p>${escapedMsg}</p>
            <button onclick="location.reload()">重新连接</button>
          </div>
        </body>
        </html>
      `;
      this.dshView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
    }
  }
}
