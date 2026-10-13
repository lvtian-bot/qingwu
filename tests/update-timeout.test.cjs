"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { loadTs } = require("./helpers/load-ts.cjs");

function createMockAutoUpdater() {
  const emitter = new EventEmitter();
  emitter.autoDownload = false;
  emitter.autoInstallOnAppQuit = false;
  emitter.checkForUpdates = () => new Promise(() => {}); // does not resolve by default
  return emitter;
}

test("UpdateService 在检查更新超时时切换为超时错误状态", async () => {
  const mockUpdater = createMockAutoUpdater();
  const { UpdateService, CHECK_TIMEOUT_MS } = loadTs("src/main/update.ts", {
    electron: {
      app: {
        getVersion: () => "0.2.8",
        getLocale: () => "zh-CN",
        isPackaged: true,
      },
    },
    "electron-updater": {
      autoUpdater: mockUpdater,
    },
  });

  const service = new UpdateService({ checkTimeoutMs: 25 });
  assert.equal(service.getState().status, "idle");

  let stateEmitted = null;
  service.onStateChange = (state) => {
    stateEmitted = state;
  };

  const checkPromise = service.check();
  assert.equal(service.getState().status, "checking");
  assert.equal(stateEmitted.status, "checking");

  const finalState = await checkPromise;
  assert.equal(finalState.status, "error");
  assert.equal(
    finalState.message,
    "连接更新服务器超时，请检查网络或前往发布页手动下载。",
  );
  assert.equal(service.getState().status, "error");
  assert.equal(
    service.getState().message,
    "连接更新服务器超时，请检查网络或前往发布页手动下载。",
  );

  // 超时后延迟抛出的 autoUpdater 错误不会覆盖当前状态
  mockUpdater.emit("error", new Error("net::ERR_CONNECTION_CLOSED"));
  assert.equal(service.getState().status, "error");
  assert.equal(
    service.getState().message,
    "连接更新服务器超时，请检查网络或前往发布页手动下载。",
  );
});

test("UpdateService 在超时前成功收到新版本时清除超时定时器", async () => {
  const mockUpdater = createMockAutoUpdater();
  const { UpdateService } = loadTs("src/main/update.ts", {
    electron: {
      app: {
        getVersion: () => "0.2.8",
        getLocale: () => "zh-CN",
        isPackaged: true,
      },
    },
    "electron-updater": {
      autoUpdater: mockUpdater,
    },
  });

  const service = new UpdateService();
  mockUpdater.checkForUpdates = () => {
    setImmediate(() => {
      mockUpdater.emit("update-available", { version: "0.2.9" });
    });
    return Promise.resolve();
  };

  const finalState = await service.check();
  assert.equal(finalState.status, "available");
  assert.equal(finalState.latestVersion, "0.2.9");
  assert.equal(service.checkTimer, null);
});

test("UpdateService 超时后重试能够成功切入新状态", async () => {
  const mockUpdater = createMockAutoUpdater();
  const { UpdateService } = loadTs("src/main/update.ts", {
    electron: {
      app: {
        getVersion: () => "0.2.8",
        getLocale: () => "zh-CN",
        isPackaged: true,
      },
    },
    "electron-updater": {
      autoUpdater: mockUpdater,
    },
  });

  const service = new UpdateService({ checkTimeoutMs: 20 });
  await service.check();
  assert.equal(service.getState().status, "error");

  // 重试时远程正常返回
  mockUpdater.checkForUpdates = () => {
    setImmediate(() => {
      mockUpdater.emit("update-not-available", { version: "0.2.8" });
    });
    return Promise.resolve();
  };

  const retryState = await service.check();
  assert.equal(retryState.status, "latest");
  assert.equal(service.getState().status, "latest");
});
