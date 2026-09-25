import {
  app,
  BrowserWindow,
  dialog,
  shell,
  nativeTheme,
} from "electron";
import type { WebContents } from "electron";
import path from "node:path";
import fs from "node:fs";
import { CONFIG } from "./config";
import { settings } from "./settings";
import { WindowStateManager } from "./window-state";
import { observeWebContents } from "./diagnostics";

const TITLE_BAR_HEIGHT = 35;

const TITLE_BAR_OVERLAY_COLORS = {
  dark: { color: "#181825", symbolColor: "#a6adc8" },
  light: { color: "#eef4f9", symbolColor: "#6b6b6b" },
} as const;

export class WindowManager {
  mainWindow: BrowserWindow | null = null;
  isQuitting = false;
  private wasMaximized = false;
  private windowState = new WindowStateManager();

  constructor() {
    nativeTheme.on("updated", () => this.applyTitleBarOverlay());
  }

  getIconPath(): string | undefined {
    const possiblePaths = [
      path.join(app.getAppPath(), "build", "icon.ico"),
      path.join(app.getAppPath(), "build", "icon.png"),
      path.join(process.resourcesPath, "build", "icon.ico"),
      path.join(process.resourcesPath, "build", "icon.png"),
      path.join(process.cwd(), "build", "icon.ico"),
      path.join(process.cwd(), "build", "icon.png"),
      path.join(process.cwd(), "src", "main", "assets", "icon.png"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return undefined;
  }

  createWindow(_url?: string): BrowserWindow {
    const icon = this.getIconPath();
    const lastState = this.windowState.load();
    this.wasMaximized = lastState.isMaximized;

    const win = new BrowserWindow({
      title: CONFIG.appName,
      width: lastState.width,
      height: lastState.height,
      x: lastState.x,
      y: lastState.y,
      minWidth: CONFIG.window.minWidth,
      minHeight: CONFIG.window.minHeight,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        ...TITLE_BAR_OVERLAY_COLORS[
          nativeTheme.shouldUseDarkColors ? "dark" : "light"
        ],
        height: TITLE_BAR_HEIGHT,
      },
      autoHideMenuBar: true,
      show: false,
      icon,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.mainWindow = win;

    win.setMenuBarVisibility(false);

    this.applyTitleBarOverlay();

    win.on("close", (e) => {
      if (!win.isMinimized()) {
        this.wasMaximized = win.isMaximized();
      }
      this.windowState.save(win, this.wasMaximized);
      if (!this.isQuitting && settings.get("closeToTray")) {
        e.preventDefault();
        win.hide();
      }
    });

    observeWebContents("主窗口", win.webContents);

    win.on("maximize", () => {
      this.wasMaximized = true;
    });
    win.on("unmaximize", () => {
      // 在 Windows 上，最小化最大化窗口时会伴随触发 unmaximize。
      // 只有在非最小化状态下发生的 unmaximize，才代表用户显式还原为普通窗口。
      if (!win.isMinimized()) {
        this.wasMaximized = false;
      }
    });
    win.on("enter-full-screen", () => {
      if (!win.isDestroyed()) {
        win.webContents.send("window:fullscreen-changed", true);
      }
    });
    win.on("leave-full-screen", () => {
      if (!win.isDestroyed()) {
        win.webContents.send("window:fullscreen-changed", false);
      }
    });

    // 主窗口外链：一律拒绝开新窗口，http(s) 转系统浏览器
    win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (targetUrl.startsWith("http:") || targetUrl.startsWith("https:")) {
        void shell.openExternal(targetUrl);
      }
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, targetUrl) => {
      if (targetUrl !== win.webContents.getURL()) {
        e.preventDefault();
        if (targetUrl.startsWith("http:") || targetUrl.startsWith("https:")) {
          void shell.openExternal(targetUrl);
        }
      }
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      win.loadFile(path.join(__dirname, "../renderer/index.html"));
    }

    win.once("ready-to-show", () => {
      if (this.wasMaximized) {
        win.maximize();
      }
      win.show();
      this.focus();
    });

    win.on("closed", () => {
      this.mainWindow = null;
    });

    return win;
  }

  applyTitleBarOverlay(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const colors =
      TITLE_BAR_OVERLAY_COLORS[
        nativeTheme.shouldUseDarkColors ? "dark" : "light"
      ];
    this.mainWindow.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT });
  }

  getTargetWebContents(): WebContents | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow.webContents;
    }
    return null;
  }

  focus(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const win = this.mainWindow;
      if (!win.isVisible()) {
        win.show();
      }
      if (win.isMinimized()) {
        win.restore();
      }
      if (this.wasMaximized && !win.isMaximized()) {
        win.maximize();
      }
      win.focus();
      win.webContents.focus();
    }
  }

  showErrorMessage(title: string, message: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      dialog.showErrorBox(title, message);
    }
  }
}
