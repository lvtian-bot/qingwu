"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { loadTs } = require("./helpers/load-ts.cjs");
const {
  getMenuBounds,
  MENU_SHADOW_INSET_X: insetX,
  MENU_SHADOW_INSET_TOP: insetTop,
} = loadTs("src/shared/menu-layout.ts");

test("菜单坐标按页面倍率转换，投影不改变面板锚点且顶部不侵入标题栏", () => {
  const content = { x: 100, y: 50, width: 900, height: 700 };
  const b = getMenuBounds(
    content,
    { x: 120, y: 35 },
    1.5,
    { width: 260, height: 300 },
    { x: 0, y: 0, width: 1920, height: 1080 },
  );
  assert.equal(b.x + insetX, 280);
  assert.equal(b.y + insetTop, 103);
  assert.equal(b.y, 103);
});
test("菜单限制在负坐标副屏工作区，超高菜单以窗口高度约束", () => {
  const area = { x: -1280, y: 0, width: 1280, height: 720 };
  const b = getMenuBounds(
    { x: -100, y: 650, width: 900, height: 700 },
    { x: 40, y: 35 },
    1,
    { width: 400, height: 1000 },
    area,
  );
  assert.deepEqual(b, { x: -400, y: 0, width: 400, height: 720 });
});
function fixture() {
  const handlers = new Map();
  const messages = [];
  let popup;
  let restored = 0;
  class Window extends EventEmitter {
    constructor() {
      super();
      popup = this;
      this.visible = false;
      this.webContents = { send: (...args) => messages.push(args) };
    }
    isDestroyed() {
      return false;
    }
    setMenu() {}
    loadFile() {
      return Promise.resolve();
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(b) {
      this.bounds = b;
    }
    getContentSize() {
      return [this.bounds?.width ?? 284, this.bounds?.height ?? 336];
    }
    setPosition() {}
    isVisible() {
      return this.visible;
    }
    show() {
      this.visible = true;
    }
    focus() {}
    destroy() {}
  }
  const parent = new EventEmitter();
  parent.isDestroyed = () => false;
  parent.getContentBounds = () => ({ x: 100, y: 50, width: 900, height: 700 });
  parent.webContents = {
    send: (...args) => messages.push(args),
    getZoomFactor: () => 1.5,
  };
  const { MenuPopupManager } = loadTs("src/main/menu-popup.ts", {
    electron: {
      BrowserWindow: Window,
      ipcMain: {
        handle: (n, f) => handlers.set(n, f),
        removeHandler: (n) => handlers.delete(n),
      },
      screen: {
        getDisplayNearestPoint: () => ({
          workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        }),
      },
    },
    "./settings": {
      settings: { get: (key) => (key === "uiMode" ? "native" : false) },
    },
  });
  const manager = new MenuPopupManager({
    getMainWindow: () => parent,
    onAction() {},
    restoreFocus() {
      restored++;
    },
  });
  return {
    manager,
    handlers,
    messages,
    parent,
    popup,
    get restored() {
      return restored;
    },
  };
}
test("方向键请求标题栏重测目标锚点，关闭后迟到切换不得重开", () => {
  const f = fixture();
  f.manager.open("视图", 120, 35);
  f.manager.switchMenu("right");
  assert.deepEqual(f.messages.at(-1), ["titlebar:menu-switch", "帮助"]);
  f.manager.open("帮助", 170, 35, true);
  assert.equal(f.popup.bounds.x + insetX, 355);
  f.manager.close();
  assert.equal(f.restored, 1);
  const count = f.messages.length;
  f.manager.open("视图", 120, 35, true);
  assert.equal(f.messages.length, count);
  f.manager.destroy();
  assert.equal(f.handlers.size, 0);
});
test("过期菜单尺寸回报不能改变当前窗口，失焦关闭不抢焦点", () => {
  const f = fixture();
  f.manager.open("文件", 50, 35);
  const first = f.messages.at(-1)[1];
  f.manager.open("帮助", 170, 35, true);
  const before = f.popup.bounds;
  f.handlers.get("menu-popup:resize")(
    { sender: f.popup.webContents },
    { menuName: "文件", sessionId: first.sessionId, width: 900, height: 900 },
  );
  assert.deepEqual(f.popup.bounds, before);
  f.manager.close("blur");
  assert.equal(f.restored, 0);
  f.manager.destroy();
});
test("隐藏快捷键与自绘菜单共用定义和动作入口", () => {
  let template;
  const actions = [];
  const { createApplicationMenu } = loadTs("src/main/menu.ts", {
    electron: {
      Menu: {
        buildFromTemplate: (t) => {
          template = t;
          return t;
        },
        setApplicationMenu() {},
      },
    },
    "./settings": {
      settings: { get: (key) => (key === "uiMode" ? "native" : false) },
    },
  });
  createApplicationMenu({ onAction: (id) => actions.push(id) });
  const settings = template
    .find((m) => m.label === "编辑")
    .submenu.find((m) => m.label === "设置");
  assert.equal(settings.accelerator, "Ctrl+,");
  settings.click();
  assert.deepEqual(actions, ["settings"]);
  const zoom = template
    .find((m) => m.label === "视图")
    .submenu.find((m) => m.label === "放大");
  assert.equal(zoom.accelerator, "Ctrl+Plus");
});
