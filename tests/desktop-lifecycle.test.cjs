"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { loadTs } = require("./helpers/load-ts.cjs");

const { AppLifecycle } = loadTs("src/main/app-lifecycle.ts");
const { createLineReader, redactSecrets } = loadTs("src/main/logging.ts");
const {
  sanitizeDiagnosticUrl,
  formatProcessMetrics,
} = loadTs("src/main/diagnostics.ts", { electron: { app: {} } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("黑屏诊断会移除页面凭据并按进程汇总内存", () => {
  assert.equal(
    sanitizeDiagnosticUrl(
      "http://127.0.0.1:3080/session/a?token=fixture-secret#private",
    ),
    "http://127.0.0.1:3080/session/a",
  );
  assert.equal(
    sanitizeDiagnosticUrl("data:text/html,fixture-secret"),
    "data:[omitted]",
  );
  assert.equal(
    formatProcessMetrics([
      {
        pid: 42,
        type: "GPU",
        name: "GPU Process",
        serviceName: undefined,
        memory: {
          workingSetSize: 2048,
          privateBytes: 1024,
          peakWorkingSetSize: 4096,
        },
      },
    ]),
    "GPU:GPU Process:pid=42:ws=2.0MB:private=1.0MB",
  );
});

test("退出会阻止默认退出、等待清理，重复请求只清理一次", async () => {
  let finishStop;
  const calls = [];
  const gate = new AppLifecycle({
    stop: () => {
      calls.push("stop");
      return new Promise((resolve) => {
        finishStop = resolve;
      });
    },
    setQuitting: (value) => calls.push(value),
    finish: () => calls.push("finish"),
    quit: () => calls.push("quit"),
    failed: () => assert.fail("清理不应失败"),
  });
  const event = { preventDefault: () => calls.push("prevent") };
  gate.beforeQuit(event);
  gate.beforeQuit(event);
  await tick();
  assert.deepEqual(calls, ["prevent", true, "prevent", "stop"]);
  finishStop();
  await tick();
  assert.deepEqual(calls.slice(-2), ["finish", "quit"]);
  const length = calls.length;
  gate.beforeQuit(event);
  assert.equal(calls.length, length);
});

test("清理失败恢复关闭状态，保留桌面资源并可重试退出", async () => {
  let attempts = 0;
  const calls = [];
  const gate = new AppLifecycle({
    stop: async () => {
      if (++attempts === 1) throw new Error("test failure");
    },
    setQuitting: (value) => calls.push(value),
    finish: () => calls.push("finish"),
    quit: () => calls.push("quit"),
    failed: () => calls.push("failed"),
  });
  gate.beforeQuit({ preventDefault() {} });
  await tick();
  assert.deepEqual(calls, [true, false, "failed"]);
  gate.beforeQuit({ preventDefault() {} });
  await tick();
  assert.deepEqual(calls.slice(-3), [true, "finish", "quit"]);
});

test("分块启动地址和中文不丢失，完整行和无换行尾部均脱敏", () => {
  const output = [];
  const reader = createLineReader((line) => output.push(redactSecrets(line)));
  const bytes = Buffer.from(
    "中文 dsh web: http://127.0.0.1:3080/?token=fixture-secret\n",
  );
  for (const byte of bytes) reader.write(Buffer.from([byte]));
  reader.write("tail http://localhost/?access_token=fixture-tail");
  reader.end();
  assert.equal(
    output[0],
    "中文 dsh web: http://127.0.0.1:3080/?token=[REDACTED]",
  );
  assert.equal(output[1], "tail http://localhost/?access_token=[REDACTED]");
  assert.equal(
    redactSecrets(new Error("failed ?token=fixture-value&x=1")),
    "failed ?token=[REDACTED]&x=1",
  );
  assert.equal(
    redactSecrets('Authorization: Bearer fixture-value, {"apiKey":"fixture-key"}'),
    'Authorization: Bearer [REDACTED], {"apiKey":"[REDACTED]"}',
  );
  assert.equal(
    redactSecrets("password=fixture-password"),
    "password=[REDACTED]",
  );
});

function harnessFixture(t, { respond = true } = {}) {
  const logs = [];
  for (const method of ["log", "warn", "error"]) {
    t.mock.method(console, method, (...args) => logs.push(args.join(" ")));
  }
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 24680,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  let killCallback;
  let killCalls = 0;
  const requests = [];
  t.mock.method(process, "kill", () => true);
  const { HarnessManager } = loadTs("src/main/harness.ts", {
    electron: {
      app: {
        isPackaged: false,
        getAppPath: () => "D:/fixture",
        getPath: () => "D:/fixture",
      },
    },
    "node:fs": { existsSync: () => true },
    "./config": {
      CONFIG: {
        defaultHost: "127.0.0.1",
        defaultPort: 3080,
        readinessTimeoutMs: 30,
        readinessPollIntervalMs: 1,
      },
    },
    "node:child_process": {
      spawn: () => child,
      execFile: (command, args, options, callback) => {
        assert.equal(command, "taskkill.exe");
        assert.deepEqual(args, ["/pid", "24680", "/T", "/F"]);
        assert.equal(options.windowsHide, true);
        assert.ok(options.timeout > 0);
        killCalls += 1;
        killCallback = callback;
      },
    },
    "node:http": {
      get: (url, callback) => {
        requests.push(url);
        const request = new EventEmitter();
        request.setTimeout = () => request;
        request.destroy = () => {
          queueMicrotask(() => request.emit("error", new Error("cancelled")));
        };
        if (respond)
          queueMicrotask(() => callback({ statusCode: 303, resume() {} }));
        return request;
      },
    },
  });
  return {
    manager: new HarnessManager({ hasConsole: true }),
    child,
    logs,
    requests,
    finishKill: (err) => killCallback(err),
    killCalls: () => killCalls,
  };
}

test("引擎保留跨 chunk 鉴权地址，普通服务地址与日志不带凭据", async (t) => {
  const fixture = harnessFixture(t);
  const started = fixture.manager.start();
  fixture.child.stdout.write("dsh web: http://127.0.0.1:3080/?tok");
  fixture.child.stdout.write("en=fixture-secret\n");
  fixture.child.stderr.end("failure ?token=fixture-error");
  await started;
  await tick();
  assert.equal(fixture.manager.getServiceUrl(), "http://127.0.0.1:3080");
  assert.equal(
    new URL(fixture.manager.getWebUrl()).searchParams.has("token"),
    true,
  );
  assert.equal(
    fixture.logs.some((line) => /fixture-secret|fixture-error/.test(line)),
    false,
  );
});

test(
  "启动期间退出取消就绪探测，多次 stop 共用真实清理结果",
  { skip: process.platform !== "win32" },
  async (t) => {
    const fixture = harnessFixture(t, { respond: false });
    const started = fixture.manager.start();
    const rejected = assert.rejects(started, /启动已取消/);
    const first = fixture.manager.stop();
    const second = fixture.manager.stop();
    assert.equal(first, second);
    assert.equal(fixture.killCalls(), 1);
    let stopped = false;
    first.then(() => {
      stopped = true;
    });
    await tick();
    assert.equal(stopped, false);
    fixture.finishKill(null);
    await first;
    await rejected;
    await assert.rejects(fixture.manager.start(), /启动已取消/);
  },
);

test(
  "Windows 进程树清理错误不会被当成成功，后续退出能够重试",
  { skip: process.platform !== "win32" },
  async (t) => {
    const fixture = harnessFixture(t);
    await fixture.manager.start();
    const stopped = fixture.manager.stop();
    fixture.finishKill(new Error("access denied"));
    await assert.rejects(stopped, /停止引擎进程树失败/);
    const retry = fixture.manager.stop();
    assert.equal(fixture.killCalls(), 2);
    fixture.finishKill(null);
    await retry;
  },
);

test(
  "服务已就绪的响应在退出请求之后到达也不能完成启动",
  { skip: process.platform !== "win32" },
  async (t) => {
    const fixture = harnessFixture(t);
    const started = fixture.manager.start();
    const rejected = assert.rejects(started, /启动已取消/);
    const stop = fixture.manager.stop();
    fixture.finishKill(null);
    await Promise.all([stop, rejected]);
  },
);

test(
  "taskkill 与根进程退出竞态不会永久阻止退出，权限不足仍返回失败",
  { skip: process.platform !== "win32" },
  async (t) => {
    const fixture = harnessFixture(t);
    await fixture.manager.start();
    process.kill.mock.mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    });
    const first = fixture.manager.stop();
    fixture.finishKill(new Error("taskkill denied"));
    await assert.rejects(first, /停止引擎进程树失败/);
    process.kill.mock.mockImplementation(() => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    });
    const retry = fixture.manager.stop();
    fixture.child.exitCode = 0;
    fixture.child.emit("exit", 0, null);
    fixture.finishKill(new Error("process not found"));
    await retry;
    await fixture.manager.stop();
    assert.equal(fixture.killCalls(), 2);
  },
);

test("菜单目标和焦点跟随当前界面，鉴权跳转按完整 origin 判断", () => {
  const { WindowManager, isServiceNavigation } = loadTs("src/main/window.ts", {
    electron: { nativeTheme: { on() {} } },
    "./settings": { settings: { get: () => "official" } },
    "./window-state": { WindowStateManager: class {} },
    "./config": { CONFIG: {} },
  });
  const focused = [];
  const official = {
    isDestroyed: () => false,
    focus: () => focused.push("official"),
  };
  const native = {
    isDestroyed: () => false,
    focus: () => focused.push("native"),
    send() {},
  };
  const manager = new WindowManager();
  const boundsCalls = [];
  const visibilityCalls = [];
  manager.mainWindow = {
    webContents: native,
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    getContentSize: () => [1200, 800],
    isFullScreen: () => false,
    focus() {},
  };
  manager.dshView = {
    webContents: official,
    setVisible: (val) => visibilityCalls.push(val),
    setBounds: (rect) => boundsCalls.push(rect),
  };
  assert.equal(manager.getTargetWebContents(), official);
  manager.applyUiMode("native");
  assert.equal(manager.getTargetWebContents(), native);
  assert.equal(visibilityCalls.at(-1), false);
  const boundsCountBeforeOfficial = boundsCalls.length;
  manager.focus();
  assert.equal(focused.at(-1), "native");
  manager.applyUiMode("official");
  assert.equal(visibilityCalls.at(-1), true);
  assert.equal(boundsCalls.length, boundsCountBeforeOfficial + 1);
  assert.deepEqual(boundsCalls.at(-1), {
    x: 0,
    y: 35,
    width: 1200,
    height: 765,
  });
  manager.focus();
  assert.equal(focused.at(-1), "official");
  assert.equal(
    isServiceNavigation(
      "http://127.0.0.1:3080/session/a",
      "http://127.0.0.1:3080",
    ),
    true,
  );
  assert.equal(
    isServiceNavigation("http://127.0.0.1:30800/", "http://127.0.0.1:3080"),
    false,
  );
  assert.equal(
    isServiceNavigation(
      "http://127.0.0.1:3080.evil.test/",
      "http://127.0.0.1:3080",
    ),
    false,
  );
  assert.equal(
    isServiceNavigation("javascript:void(0)", "http://127.0.0.1:3080"),
    false,
  );
});

test("主入口先提供托盘退出入口，启动期间退出后不创建窗口，无托盘也可重新打开重试", async (t) => {
  const calls = [];
  let completeStart;
  let attempts = 0;
  const app = new EventEmitter();
  app.getPath = () => "D:/fixture";
  app.requestSingleInstanceLock = () => true;
  app.setAppUserModelId = () => {};
  app.whenReady = () => Promise.resolve();
  app.quit = () => {
    calls.push("quit");
    app.emit("before-quit", { preventDefault() {} });
  };
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  loadTs("src/main/index.ts", {
    "./paths": {},
    electron: {
      app,
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      ipcMain: { handle() {}, on() {} },
      powerMonitor: new EventEmitter(),
      shell: {},
    },
    "./console": { acquireHiddenConsole: () => true },
    "./harness": {
      HarnessManager: class {
        start() {
          calls.push("start");
          return new Promise((resolve) => {
            completeStart = resolve;
          });
        }
        async stop() {
          calls.push("stop");
          if (++attempts === 1) throw new Error("fixture cleanup failure");
        }
        getWebUrl() {
          return "http://127.0.0.1:3080";
        }
      },
    },
    "./window": {
      WindowManager: class {
        mainWindow = null;
        getIconPath() {
          return undefined;
        }
        createWindow() {
          calls.push("window");
        }
        focus() {
          calls.push("focus");
        }
      },
    },
    "./menu": { createApplicationMenu() {} },
    "./about": { setupAboutPanel() {} },
    "./update": { UpdateService: class {} },
    "./update-window": { UpdateWindowManager: class {} },
    "./tray": {
      TrayManager: class {
        init() {
          calls.push("tray-init");
        }
        destroy() {
          calls.push("tray-destroy");
        }
      },
    },
    "./dsh-bridge": {
      DshBridge: class {
        start() {
          calls.push("bridge-start");
        }
        stop() {
          calls.push("bridge-stop");
        }
      },
    },
    "./settings": { settings: { onChange() {} } },
    "./config": { CONFIG: {} },
  });
  await tick();
  assert.deepEqual(calls, ["tray-init", "start"]);
  app.quit();
  await tick();
  completeStart();
  await tick();
  assert.equal(calls.includes("window"), false);
  assert.equal(calls.includes("tray-destroy"), false);
  app.emit("second-instance");
  await tick();
  assert.equal(attempts, 2);
  assert.deepEqual(calls.slice(-3), ["tray-destroy", "bridge-stop", "quit"]);
});
