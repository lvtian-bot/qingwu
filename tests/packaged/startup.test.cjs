"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");
const { loadTs } = require("../helpers/load-ts.cjs");

test("Windows 打包引擎可避开旧端口，并通过桌面通信桥提供 DeepSeek 账号和模型设置", { timeout: 180000 }, async (t) => {
  // 旧端口在 CI 上可能本来就被系统保留或占用。
  const oldPort = net.createServer();
  await new Promise((resolve, reject) => {
    oldPort.once("error", (error) => {
      if (["EADDRINUSE", "EACCES"].includes(error.code)) resolve();
      else reject(error);
    });
    oldPort.listen(3080, "127.0.0.1", resolve);
  });
  t.after(() => { if (oldPort.listening) oldPort.close(); });

  // 引擎按模块文件所在位置向上解析依赖。打包目录位于仓库内时，Node 会越过
  // 安装包边界继续向上，从仓库自己的 node_modules 里拿到安装包并未携带的包，
  // 让缺失依赖的安装包假通过（0.3.5 即因此漏发 @deepseek-ai/dsh-error）。
  // 复制到仓库外再启动，解析链才与用户机器一致。
  const packagedResources = path.resolve(__dirname, "../../dist/win-unpacked/resources");
  assert.ok(fs.existsSync(packagedResources), "未找到打包产物，请先执行 npm run dist");
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qw-packaged-"));
  const repositoryRoot = path.resolve(__dirname, "../..");
  assert.ok(
    !isolatedRoot.toLowerCase().startsWith(repositoryRoot.toLowerCase() + path.sep),
    `打包引擎必须复制到仓库外再启动，当前临时目录仍在仓库内：${isolatedRoot}`,
  );
  const resourcesPath = path.join(isolatedRoot, "resources");
  fs.cpSync(packagedResources, resourcesPath, { recursive: true });

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qw-engine-"));
  process.env.DSH_HOME = home;
  process.resourcesPath = resourcesPath;
  const { HarnessManager } = loadTs("src/main/harness.ts", {
    electron: { app: { isPackaged: true, getPath: () => home } },
  });
  const { DshBridge } = loadTs("src/main/dsh-bridge.ts");
  const engine = new HarnessManager();
  const bridge = new DshBridge(() => engine.getWebUrl(), () => null);
  t.after(async () => {
    bridge.stop();
    await engine.stop();
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 4 });
    fs.rmSync(isolatedRoot, { recursive: true, force: true, maxRetries: 4 });
  });
  await engine.start();
  const port = Number(new URL(engine.getServiceUrl()).port);
  assert.ok(port > 0 && port !== 3080, "打包引擎未获得可用的新端口");

  bridge.start();
  for (let attempt = 0; attempt < 50 && !bridge.isConnected(); attempt += 1) {
    await delay(100);
  }
  assert.ok(bridge.isConnected(), "桌面通信桥未连上打包引擎");

  const account = await bridge.call("account/getState", {});
  assert.ok(account.ok, "DeepSeek 账号插件未提供账号状态");
  const settings = await bridge.call("settings/describe", {});
  assert.ok(settings.ok, "引擎未返回设置");
  const namespaces = settings.value.namespaces.map(({ ns }) => ns);
  for (const name of ["llm-deepseek", "llm-deepseek-account"]) {
    assert.ok(namespaces.includes(name), `DeepSeek 模型设置未加载：${name}`);
  }
});
