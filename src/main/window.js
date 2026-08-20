import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from './config.js';

export class WindowManager {
  constructor() {
    this.mainWindow = null;
  }

  getIconPath() {
    const possiblePaths = [
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

    this.mainWindow = new BrowserWindow({
      title: CONFIG.appName,
      width: CONFIG.window.width,
      height: CONFIG.window.height,
      minWidth: CONFIG.window.minWidth,
      minHeight: CONFIG.window.minHeight,
      autoHideMenuBar: true,
      show: false,
      icon,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });

    this.mainWindow.on('page-title-updated', (e, title) => {
      e.preventDefault();
      if (title && title !== CONFIG.appName) {
        this.mainWindow.setTitle(`${CONFIG.appName} - ${title}`);
      } else {
        this.mainWindow.setTitle(CONFIG.appName);
      }
    });

    this.mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (targetUrl.startsWith('http:') || targetUrl.startsWith('https:')) {
        if (!targetUrl.startsWith(url)) {
          shell.openExternal(targetUrl);
          return { action: 'deny' };
        }
      }
      return { action: 'allow' };
    });

    this.mainWindow.webContents.on('will-navigate', (e, targetUrl) => {
      if (!targetUrl.startsWith(url)) {
        e.preventDefault();
        shell.openExternal(targetUrl);
      }
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    this.loadUrl(url);
    return this.mainWindow;
  }

  loadUrl(url) {
    if (this.mainWindow) {
      this.mainWindow.loadURL(url).catch((err) => {
        console.error('[Window] 加载页面失败:', err);
      });
    }
  }

  focus() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    }
  }

  showErrorMessage(title, message) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
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
      this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
    }
  }
}
