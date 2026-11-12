"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { loadTs } = require("./helpers/load-ts.cjs");

test("NotificationManager: 根据应用设置与系统支持状态发送通知并响应点击", () => {
  let createdNotification = null;

  class MockNotification extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      createdNotification = this;
    }
    static isSupported() {
      return MockNotification.supported;
    }
    show() {
      this.shown = true;
    }
  }
  MockNotification.supported = true;

  let currentSettings = { notifyOnTaskFinished: true };
  const mockSettings = {
    settings: {
      get: (key) => currentSettings[key],
    },
  };

  const { NotificationManager } = loadTs("src/main/notification.ts", {
    electron: { Notification: MockNotification },
    "./settings": mockSettings,
  });

  const sendCalls = [];
  let focusCalled = false;
  const mockWindowManager = {
    getIconPath: () => "build/icon.png",
    focus: () => {
      focusCalled = true;
    },
    mainWindow: {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => false,
      webContents: {
        send: (channel, ...args) => {
          sendCalls.push({ channel, args });
        },
      },
    },
  };

  const manager = new NotificationManager(mockWindowManager);

  // 1. 处于后台时（isFocused: false），正常发送通知
  manager.show({
    title: "任务执行完成",
    body: "「新会话」任务已执行完成",
    sessionId: "sess-123",
  });

  assert.ok(createdNotification, "应该创建原生 Notification 实例");
  assert.equal(createdNotification.shown, true);
  assert.equal(createdNotification.options.title, "任务执行完成");
  assert.equal(createdNotification.options.body, "「新会话」任务已执行完成");
  assert.equal(createdNotification.options.icon, "build/icon.png");

  // 模拟用户点击通知
  createdNotification.emit("click");
  assert.equal(focusCalled, true, "点击通知应聚焦主窗口");
  assert.deepEqual(sendCalls, [
    { channel: "notification:navigate", args: ["sess-123"] },
  ]);

  // 2. 处于前台使用中（isFocused: true），不应弹系统通知打扰
  createdNotification = null;
  mockWindowManager.mainWindow.isFocused = () => true;
  manager.show({
    title: "任务执行完成",
    body: "前台使用中不应弹出",
  });
  assert.equal(createdNotification, null, "前台聚焦使用时不应创建通知");
  mockWindowManager.mainWindow.isFocused = () => false;

  // 3. 当用户关闭通知设置时，不应弹出通知
  createdNotification = null;
  currentSettings.notifyOnTaskFinished = false;
  manager.show({
    title: "任务执行完成",
    body: "不应发送",
  });
  assert.equal(createdNotification, null, "关闭配置后不应创建通知");

  // 3. 当系统不支持通知时，不应抛出异常也不发送通知
  currentSettings.notifyOnTaskFinished = true;
  MockNotification.supported = false;
  manager.show({
    title: "任务执行完成",
    body: "不支持系统通知",
  });
  assert.equal(createdNotification, null, "系统不支持时不应创建通知");
});

test("NotificationManager: 活动通知保持引用直到点击或关闭，避免后台回收导致点击失效", () => {
  const created = [];
  class MockNotification extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      created.push(this);
    }
    static isSupported() {
      return true;
    }
    show() {
      this.shown = true;
    }
  }

  const { NotificationManager } = loadTs("src/main/notification.ts", {
    electron: { Notification: MockNotification },
    "./settings": { settings: { get: () => true } },
    "./i18n": { tr: (key) => key },
  });

  let focusCalls = 0;
  const mockWindowManager = {
    getIconPath: () => "build/icon.png",
    focus: () => {
      focusCalls += 1;
    },
    mainWindow: {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => false,
      webContents: { send() {} },
    },
  };
  const manager = new NotificationManager(mockWindowManager);

  manager.show({ body: "第一条", sessionId: "s1" });
  assert.equal(manager.live.length, 1, "显示后应持有通知引用");

  // 点击后释放引用，并聚焦主窗口
  created[0].emit("click");
  assert.equal(manager.live.length, 0, "点击后应释放引用");
  assert.equal(focusCalls, 1);

  // 关闭事件同样释放引用
  manager.show({ body: "第二条", sessionId: "s2" });
  assert.equal(manager.live.length, 1);
  created[1].emit("close", { reason: "timedOut" });
  assert.equal(manager.live.length, 0, "关闭后应释放引用");

  // 上限兜底：连续弹出超过上限时丢弃最旧的通知
  for (let index = 0; index < 20; index += 1) {
    manager.show({ body: `第 ${index} 条`, sessionId: `bulk-${index}` });
  }
  assert.equal(manager.live.length, 16, "活动通知引用不得超过上限");
  assert.equal(manager.live[0], created[created.length - 16]);
});
