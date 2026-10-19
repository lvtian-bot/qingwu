const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { loadTs } = require("./helpers/load-ts.cjs");
const { loadProfileDirectory, composeEntries, readProfilePatches } = require("@deepseek-ai/dsh-app-boot");

function fixture(t, patch, bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-search-profile-"));
  const dir = path.join(home, "profiles", "qingwu");
  if (patch !== undefined) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name: "dsh-profile-qingwu", private: true, dependencies: {},
      dsh: { profile: { bundles } },
    }));
    fs.writeFileSync(path.join(dir, "cordis.patch.yml"), patch);
  }
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const { HarnessManager } = loadTs("src/main/harness.ts", {
    electron: { app: { isPackaged: false, getAppPath: () => process.cwd() } },
    "./dsh-paths": { resolveQingwuProfileDir: () => dir },
  });
  const harness = new HarnessManager({ host: "127.0.0.1", port: 3080 });
  const installAnchor = require.resolve("@deepseek-ai/dsh/package.json");
  function composed() {
    const profile = loadProfileDirectory("test", dir, installAnchor);
    assert.deepEqual(profile.skippedBundles, [], "所有随包 bundle 必须可正常解析");
    return composeEntries([readProfilePatches("test", {
      name: "qingwu", dir, home, patchPath: path.join(dir, "cordis.patch.yml"),
      installAnchor, cwd: process.cwd(), startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    }, profile)]);
  }
  return { home, dir, harness, composed, patch: path.join(dir, "cordis.patch.yml") };
}
function find(entries, id) {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    const nested = entry.config?.entries;
    if (Array.isArray(nested)) {
      const result = find(nested, id);
      if (result) return result;
    }
  }
}

test("新装使用 dsh 原生 bundle 默认值，用户补丁保持空层", async (t) => {
  const f = fixture(t);
  await f.harness.ensureQingwuProfile();
  assert.match(fs.readFileSync(f.patch, "utf8"), /\[\]/);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.dir, "package.json"), "utf8"));
  assert.deepEqual(manifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base", "@qingwu/dsh-profile", "@deepseek-ai/dsh-web-app",
  ]);
  const web = find(f.composed(), "web");
  assert.equal(web.config.searchProvider, "deepseek-search-api");
  assert.equal(web.config.fetchProvider, "deepseek-fetch-api");
});

for (const [label, patch] of [
  ["旧版空补丁", "# 注释\n[]\n"],
  ["行内序列及表达式", "[{ id: permission, config: { defaultPreset: !!js 'process.env.QINGWU_TEST_PRESET' } }]\n"],
  ["修改过模型和权限", "- id: agent-default-model\n  config: { provider: test, model: custom }\n- id: permission-presets\n  config: { defaultPreset: standard }\n"],
]) {
  test(label + "均取得新版搜索默认值，补丁字节保持原样且重复启动不追加", async (t) => {
    const f = fixture(t, patch);
    await Promise.all([f.harness.ensureQingwuProfile(), f.harness.ensureQingwuProfile()]);
    await f.harness.ensureQingwuProfile();
    assert.equal(fs.readFileSync(f.patch, "utf8"), patch);
    assert.equal(find(f.composed(), "web").config.searchProvider, "deepseek-search-api");
    const manifest = JSON.parse(fs.readFileSync(path.join(f.dir, "package.json"), "utf8"));
    assert.equal(manifest.dsh.profile.bundles.filter((b) => b === "@qingwu/dsh-profile").length, 1);
  });
}

test("明确选择旧版或其他服务时由用户层覆盖应用默认层", async (t) => {
  for (const provider of ["deepseek-official", "exa", "custom-search"]) {
    const patch = "- id: web\n  config:\n    searchProvider: " + provider + "\n    fetchProvider: http\n";
    const f = fixture(t, patch);
    await f.harness.ensureQingwuProfile();
    assert.equal(find(f.composed(), "web").config.searchProvider, provider);
    assert.equal(fs.readFileSync(f.patch, "utf8"), patch);
  }
});

test("更高优先级的 Harness home 配置依旧生效", async (t) => {
  const f = fixture(t, "[]\n");
  fs.writeFileSync(path.join(f.home, "cordis.patch.yml"), "- id: web\n  config: { searchProvider: perplexity, fetchProvider: http }\n");
  await f.harness.ensureQingwuProfile();
  assert.equal(find(f.composed(), "web").config.searchProvider, "perplexity");
});

test("不采用基础 bundle 的自定义配置保持清单原样", async (t) => {
  const f = fixture(t, "[]\n", []);
  await f.harness.ensureQingwuProfile();
  const manifest = JSON.parse(fs.readFileSync(path.join(f.dir, "package.json"), "utf8"));
  assert.deepEqual(manifest.dsh.profile.bundles, []);
});

test("配置清单损坏时停止初始化，不覆盖原文件或用户补丁", async (t) => {
  const f = fixture(t, "[]\n");
  fs.writeFileSync(path.join(f.dir, "package.json"), "{");
  t.mock.method(console, "warn", () => {});
  await assert.rejects(f.harness.ensureQingwuProfile(), /初始化青梧引擎配置失败/);
  assert.equal(fs.readFileSync(path.join(f.dir, "package.json"), "utf8"), "{");
  assert.equal(fs.readFileSync(f.patch, "utf8"), "[]\n");
});
