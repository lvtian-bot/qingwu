import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { MENU_NAMES, type MenuName } from "../shared/menu-data";
import { settings } from "./settings";

export interface MenuPopupOptions {
  getMainWindow: () => BrowserWindow | null;
  onAction: (actionId: string) => void;
}

/** 创建初值；打开后由渲染层实测上报宽高覆盖（宽度随菜单内容自适应）。 */
const POPUP_WIDTH = 252;
const POPUP_MIN_WIDTH = 180;
const POPUP_MIN_HEIGHT = 40;
const POPUP_MAX_HEIGHT = 600;
/** 关闭时窗口挪到的屏外坐标（Windows 最小化窗口的同款停放区，任何显示布局之外）。 */
const POPUP_OFFSCREEN_X = -32000;
const POPUP_OFFSCREEN_Y = -32000;

/**
 * 菜单弹层：独立透明无边框子窗口。
 * 操作系统层面天然压在 WebContentsView（官方界面）之上，双界面共用同一套自绘渲染，
 * 不推挤、不遮挡、无黑带。
 */
export class MenuPopupManager {
  private popupWindow: BrowserWindow | null = null;
  private currentMenu: MenuName | null = null;
  private isShowing = false;
  private lastX = 0;
  private lastY = 0;
  /** 打开会话号：仅用户发起新打开时递增，悬停/方向键穿梭不递增（不重放入场动画）。 */
  private openSession = 0;
  /** 各菜单上次实测窗口尺寸（DIP）：打开前预置，杜绝内容先被旧尺寸裁剪再撑开的可见跳动。 */
  private readonly menuSizes = new Map<
    MenuName,
    { width: number; height: number }
  >();
  private readonly getMainWindow: () => BrowserWindow | null;
  private readonly onAction: (actionId: string) => void;

  constructor(options: MenuPopupOptions) {
    this.getMainWindow = options.getMainWindow;
    this.onAction = options.onAction;
    this.setupIpc();
    this.ensureWindow();
  }

  private ensureWindow(): BrowserWindow | null {
    const parent = this.getMainWindow();
    if (!parent || parent.isDestroyed()) return null;

    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      return this.popupWindow;
    }

    const win = new BrowserWindow({
      parent,
      width: POPUP_WIDTH,
      height: 320,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
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
      },
    });

    win.setMenu(null);

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=menu`);
    } else {
      void win.loadFile(path.join(__dirname, "../renderer/index.html"), {
        search: "view=menu",
      });
    }

    // 点击弹窗外部 / 切走焦点：关闭。仅 blur 路径记录去抖窗口。
    win.on("blur", () => this.close("blur"));
    // 主窗口移动 / 缩放时菜单锚点失效，直接关闭（对齐原生菜单行为）。
    parent.on("resize", () => this.close("explicit"));
    parent.on("move", () => this.close("explicit"));

    this.popupWindow = win;
    return win;
  }

  open(
    menuName: MenuName,
    relativeX: number,
    relativeY: number,
    viaSwitch = false,
  ): void {
    const parent = this.getMainWindow();
    if (!parent || parent.isDestroyed()) return;

    const win = this.ensureWindow();
    if (!win) return;

    // 先记下弹层当前是否在屏上：决定预置尺寸用「屏外直接设」还是「屏内只放大」。
    const wasOnscreen = this.isShowing;

    if (!viaSwitch) {
      this.openSession += 1;
    }

    // 以主窗口内容区为基准换算屏幕坐标，规避隐藏标题栏的隐形边框偏移。
    const contentBounds = parent.getContentBounds();
    const x = Math.round(contentBounds.x + relativeX);
    const y = Math.round(contentBounds.y + relativeY);
    this.lastX = relativeX;
    this.lastY = relativeY;

    this.currentMenu = menuName;
    this.isShowing = true;

    // 预置窗口尺寸（缓存自该菜单上次实测）：屏外换尺寸不可见，杜绝内容先被旧尺寸
    // 裁剪、随后才被回报撑开的可见跳动；屏内穿梭只放大不缩小，缩小交给实测回报
    // 自然收紧（立即缩小会把正在显示的菜单裁出一帧缺口）。
    const cached = this.menuSizes.get(menuName);
    if (cached) {
      const [cw, ch] = win.getContentSize();
      if (!wasOnscreen) {
        if (cw !== cached.width || ch !== cached.height) {
          win.setContentSize(cached.width, cached.height);
        }
      } else if (cached.width > cw || cached.height > ch) {
        win.setContentSize(
          Math.max(cached.width, cw),
          Math.max(cached.height, ch),
        );
      }
    }

    const payload = {
      menuName,
      sessionId: this.openSession,
      context: {
        closeToTray: Boolean(settings.get("closeToTray")),
        uiMode: settings.get("uiMode") || "native",
      },
    };
    // 高度不在此处计算：渲染层 ResizeObserver 实测后经 menu-popup:resize 回报，
    // DOM 尺寸是唯一事实来源，样式调整不会造成裁剪或留空。
    const [curX, curY] = win.getPosition();
    if (curX !== x || curY !== y) {
      win.setPosition(x, y);
    }
    win.webContents.send("menu-popup:data", payload);

    if (!win.isVisible()) {
      win.show();
    }
    // 常驻窗口策略下（关闭只是挪出屏外）show 不再承担激活，需显式聚焦以支持键盘导航。
    win.focus();
  }

  /** 左右方向键 / 悬停导致的顶级菜单穿梭：原位换内容。 */
  switchMenu(direction: "left" | "right"): void {
    if (!this.isShowing || !this.currentMenu) return;
    const index = MENU_NAMES.indexOf(this.currentMenu);
    if (index === -1) return;
    const next =
      direction === "right"
        ? (index + 1) % MENU_NAMES.length
        : (index - 1 + MENU_NAMES.length) % MENU_NAMES.length;
    this.open(MENU_NAMES[next], this.lastX, this.lastY, true);
  }

  close(reason: "blur" | "explicit" = "explicit"): void {
    if (!this.isShowing) return;
    this.isShowing = false;
    this.currentMenu = null;

    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      const win = this.popupWindow;
      // 不用 hide()：Windows 透明窗口反复 show/hide，DWM 重定向时序会让下次显示
      // 先闪出旧表面。改为把窗口挪出屏幕常驻，随后清空内容——窗口已不可见，清空
      // 无竞态，表面在下次打开前必然已翻新。
      win.setPosition(POPUP_OFFSCREEN_X, POPUP_OFFSCREEN_Y);
      if (win.isVisible()) {
        win.webContents.send("menu-popup:data", null);
      }
    }

    const parent = this.getMainWindow();
    if (parent && !parent.isDestroyed()) {
      // 关闭原因随信号下发：标题栏据此区分「点击外部失焦关闭」与「Esc / 执行动作等显式关闭」。
      parent.webContents.send("titlebar:menu-closed", reason);
      // 显式关闭（执行动作 / Esc / 再点按钮）后把焦点还给主窗口；blur 关闭则说明用户正点向别处，不抢。
      if (reason === "explicit") {
        parent.focus();
      }
    }
  }

  private setupIpc(): void {
    ipcMain.handle(
      "menu-popup:open",
      (_event, { menuName, x, y, viaSwitch }) => {
        this.open(menuName, x, y, Boolean(viaSwitch));
      },
    );
    ipcMain.handle("menu-popup:switch", (_event, direction: "left" | "right") => {
      this.switchMenu(direction);
    });
    ipcMain.handle("menu-popup:close", () => {
      this.close("explicit");
    });
    // 渲染层实测菜单 DOM 宽高回报，窗口随之收紧（透明窗口多余区域本就不可见，无闪烁）。
    // 宽度随各菜单内容自适应（对齐原生菜单：不同顶级菜单宽度不同，左上角锚定不动）；
    // 高度 +10 DIP 安全余量：任何 DPI 换算或晚到布局差异都以"宁可多留透明区、绝不裁内容"为准。
    // 实测结果按菜单名缓存：下次打开前可精确预置窗口尺寸，不出现裁剪跳动。
    ipcMain.handle(
      "menu-popup:resize",
      (
        _event,
        size: { width: number; height: number; menuName?: string },
      ) => {
        const win = this.popupWindow;
        if (!win || win.isDestroyed()) return;
        const w = Math.max(POPUP_MIN_WIDTH, Math.round(size.width));
        const h = Math.max(
          POPUP_MIN_HEIGHT,
          Math.min(Math.round(size.height) + 10, POPUP_MAX_HEIGHT),
        );
        if (
          size.menuName &&
          (MENU_NAMES as readonly string[]).includes(size.menuName)
        ) {
          this.menuSizes.set(size.menuName as MenuName, { width: w, height: h });
        }
        const [cw, ch] = win.getContentSize();
        if (cw !== w || ch !== h) {
          win.setContentSize(w, h);
        }
      },
    );
    ipcMain.handle("menu-popup:action", (_event, actionId: string) => {
      this.close("explicit");
      this.onAction(actionId);
    });
    // 弹窗页面加载完成的握手：补发首开竞态期间可能丢失的菜单数据。
    ipcMain.handle("menu-popup:ready", (event) => {
      if (this.isShowing && this.currentMenu) {
        event.sender.send("menu-popup:data", {
          menuName: this.currentMenu,
          sessionId: this.openSession,
          context: {
            closeToTray: Boolean(settings.get("closeToTray")),
            uiMode: settings.get("uiMode") || "native",
          },
        });
      }
    });
  }

  destroy(): void {
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      this.popupWindow.destroy();
      this.popupWindow = null;
    }
  }
}
