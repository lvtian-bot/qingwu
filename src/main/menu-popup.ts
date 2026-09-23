import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { MENU_NAMES, getMenuItems, type MenuName } from "../shared/menu-data";
import {
  getMenuBounds,
  MENU_SHADOW_INSET_X,
  MENU_SHADOW_INSET_TOP,
  MENU_SHADOW_INSET_BOTTOM,
} from "../shared/menu-layout";
import { settings } from "./settings";

export interface MenuPopupOptions {
  getMainWindow: () => BrowserWindow | null;
  onAction: (actionId: string) => void;
  restoreFocus: () => void;
}

/** 独立透明子窗口使两套界面的菜单都能覆盖 WebContentsView。 */
export class MenuPopupManager {
  private popupWindow: BrowserWindow | null = null;
  private currentMenu: MenuName | null = null;
  private anchor = { x: 0, y: 0 };
  private openSession = 0;
  private readonly menuSizes = new Map<
    MenuName,
    { width: number; height: number }
  >();
  private readonly closeForParentChange = () => this.close("blur");
  private readonly channels = [
    "open",
    "switch",
    "close",
    "resize",
    "action",
    "ready",
  ];

  constructor(private readonly options: MenuPopupOptions) {
    this.setupIpc();
    this.ensureWindow();
    const parent = options.getMainWindow();
    parent?.on("resize", this.closeForParentChange);
    parent?.on("move", this.closeForParentChange);
    parent?.on("hide", this.closeForParentChange);
    parent?.on("minimize", this.closeForParentChange);
  }

  private context() {
    return {
      uiMode: settings.get("uiMode") || ("native" as const),
    };
  }

  private sendData() {
    const parent = this.options.getMainWindow();
    if (!parent || parent.isDestroyed()) return;
    const content = parent.getContentBounds();
    const zoom = parent.webContents.getZoomFactor();
    const area = screen.getDisplayNearestPoint({
      x: Math.round(content.x + this.anchor.x * zoom),
      y: Math.round(content.y + this.anchor.y * zoom),
    }).workArea;
    this.popupWindow?.webContents.send(
      "menu-popup:data",
      this.currentMenu
        ? {
            menuName: this.currentMenu,
            sessionId: this.openSession,
            context: this.context(),
            maxWidth: area.width - 2 * MENU_SHADOW_INSET_X,
            maxHeight:
              area.height - (MENU_SHADOW_INSET_TOP + MENU_SHADOW_INSET_BOTTOM),
          }
        : null,
    );
  }

  private ensureWindow(): BrowserWindow | null {
    const parent = this.options.getMainWindow();
    if (!parent || parent.isDestroyed()) return null;
    if (this.popupWindow && !this.popupWindow.isDestroyed())
      return this.popupWindow;
    const win = new BrowserWindow({
      parent,
      width: 284,
      height: 336,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      focusable: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
        // 独立 session 防止同源主页面的缩放同步到菜单窗口。
        partition: "qingwu-menu",
        zoomFactor: 1,
      },
    });
    win.setMenu(null);
    this.popupWindow = win;
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=menu`);
    } else {
      void win.loadFile(path.join(__dirname, "../renderer/index.html"), {
        search: "view=menu",
      });
    }
    win.on("blur", () => this.close("blur"));
    return win;
  }

  private place(size?: { width: number; height: number }) {
    const parent = this.options.getMainWindow();
    const win = this.popupWindow;
    if (
      !this.currentMenu ||
      !parent ||
      parent.isDestroyed() ||
      !win ||
      win.isDestroyed()
    )
      return;
    const content = parent.getContentBounds();
    const zoom = parent.webContents.getZoomFactor();
    const point = {
      x: Math.round(content.x + this.anchor.x * zoom),
      y: Math.round(content.y + this.anchor.y * zoom),
    };
    const area = screen.getDisplayNearestPoint(point).workArea;
    const wanted = size ??
      this.menuSizes.get(this.currentMenu) ?? { width: 284, height: 336 };
    win.setBounds(getMenuBounds(content, this.anchor, zoom, wanted, area));
  }

  open(menuName: MenuName, x: number, y: number, viaSwitch = false) {
    if (
      !MENU_NAMES.includes(menuName) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      return;
    // 迟到的切换回执不得重新打开已经关闭的菜单。
    if (viaSwitch && !this.currentMenu) return;
    const win = this.ensureWindow();
    if (!win) return;
    const wasShowing = Boolean(this.currentMenu);
    if (!viaSwitch) this.openSession += 1;
    this.currentMenu = menuName;
    this.anchor = { x, y };
    // 切换时先保留旧面板所需空间，待新 DOM 实测后再收紧，避免旧内容被提前裁一帧。
    if (wasShowing) {
      const [width, height] = win.getContentSize();
      const cached = this.menuSizes.get(menuName);
      this.place({
        width: Math.max(width, cached?.width ?? 284),
        height: Math.max(height, cached?.height ?? 352),
      });
    } else {
      this.place();
    }
    this.sendData();
    if (!win.isVisible()) win.show();
    win.focus();
  }

  switchMenu(direction: "left" | "right") {
    if (!this.currentMenu || (direction !== "left" && direction !== "right"))
      return;
    const index = MENU_NAMES.indexOf(this.currentMenu);
    const next =
      (index + (direction === "right" ? 1 : MENU_NAMES.length - 1)) %
      MENU_NAMES.length;
    // 标题栏负责重测目标按钮，并同时更新其高亮，避免复用旧按钮坐标。
    this.options
      .getMainWindow()
      ?.webContents.send("titlebar:menu-switch", MENU_NAMES[next]);
  }

  close(reason: "blur" | "explicit" = "explicit") {
    if (!this.currentMenu) return;
    this.currentMenu = null;
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      // 保留既有屏外停放策略，避免透明窗口反复 show/hide 的旧帧闪烁。
      this.popupWindow.setPosition(-32000, -32000);
      this.sendData();
    }
    const parent = this.options.getMainWindow();
    if (parent && !parent.isDestroyed()) {
      parent.webContents.send("titlebar:menu-closed", reason);
      if (reason === "explicit") this.options.restoreFocus();
    }
  }

  private setupIpc() {
    ipcMain.handle(
      "menu-popup:open",
      (event, { menuName, x, y, viaSwitch }) => {
        if (event.sender !== this.options.getMainWindow()?.webContents) return;
        this.open(menuName, x, y, Boolean(viaSwitch));
      },
    );
    ipcMain.handle(
      "menu-popup:switch",
      (event, direction: "left" | "right") => {
        if (event.sender === this.popupWindow?.webContents)
          this.switchMenu(direction);
      },
    );
    ipcMain.handle("menu-popup:close", (event) => {
      if (
        event.sender === this.popupWindow?.webContents ||
        event.sender === this.options.getMainWindow()?.webContents
      )
        this.close();
    });
    ipcMain.handle(
      "menu-popup:resize",
      (
        event,
        size: {
          width: number;
          height: number;
          menuName: MenuName;
          sessionId: number;
        },
      ) => {
        if (
          event.sender !== this.popupWindow?.webContents ||
          size.menuName !== this.currentMenu ||
          size.sessionId !== this.openSession
        )
          return;
        if (
          !Number.isFinite(size.width) ||
          !Number.isFinite(size.height) ||
          size.width <= 0 ||
          size.height <= 0
        )
          return;
        const wanted = {
          width: Math.max(180, Math.ceil(size.width)) + 2 * MENU_SHADOW_INSET_X,
          height:
            Math.ceil(size.height) +
            MENU_SHADOW_INSET_TOP +
            MENU_SHADOW_INSET_BOTTOM,
        };
        this.menuSizes.set(size.menuName, wanted);
        this.place(wanted);
      },
    );
    ipcMain.handle("menu-popup:action", (event, actionId: string) => {
      if (event.sender !== this.popupWindow?.webContents || !this.currentMenu)
        return;
      const item = getMenuItems(this.currentMenu, this.context()).find(
        (item) => item.id === actionId,
      );
      if (!item || item.type === "separator" || item.disabled) return;
      this.close();
      this.options.onAction(actionId);
    });
    ipcMain.handle("menu-popup:ready", (event) => {
      if (event.sender === this.popupWindow?.webContents) this.sendData();
    });
  }

  destroy() {
    this.currentMenu = null;
    const parent = this.options.getMainWindow();
    parent?.removeListener("resize", this.closeForParentChange);
    parent?.removeListener("move", this.closeForParentChange);
    parent?.removeListener("hide", this.closeForParentChange);
    parent?.removeListener("minimize", this.closeForParentChange);
    for (const name of this.channels)
      ipcMain.removeHandler(`menu-popup:${name}`);
    if (this.popupWindow && !this.popupWindow.isDestroyed())
      this.popupWindow.destroy();
    this.popupWindow = null;
  }
}
