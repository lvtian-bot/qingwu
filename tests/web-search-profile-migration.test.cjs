const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { loadTs } = require("./helpers/load-ts.cjs");

function setupHarness(profileDir) {
  const { HarnessManager } = loadTs("src/main/harness.ts", {
    electron: {
      app: {
        isPackaged: false,
        getAppPath: () => process.cwd(),
      },
    },
    "./dsh-paths": {
      resolveQingwuProfileDir: () => profileDir,
    },
  });
  return new HarnessManager({ host: "127.0.0.1", port: 3080 });
}

test("全新安装初始化时自动写入默认新版高速搜索配置", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-test-profile-"));
  try {
    const harness = setupHarness(tmp);
    harness["ensureQingwuProfile"]();

    const patchPath = path.join(tmp, "cordis.patch.yml");
    assert.ok(fs.existsSync(patchPath), "cordis.patch.yml 应当被自动创建");
    const content = fs.readFileSync(patchPath, "utf-8");
    assert.match(content, /id:\s*web/, "应当包含 id: web 节点");
    assert.match(content, /searchProvider:\s*deepseek-search-api/, "应当预设为 deepseek-search-api");
    assert.match(content, /fetchProvider:\s*deepseek-fetch-api/, "应当预设为 deepseek-fetch-api");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("老版未定制空配置文档（带注释与 []）平滑升级为默认新版搜索配置", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-test-profile-"));
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const legacyEmptyPatch = "# 青梧专属 profile 补丁层\n[]\n";
    const patchPath = path.join(tmp, "cordis.patch.yml");
    fs.writeFileSync(patchPath, legacyEmptyPatch);

    const harness = setupHarness(tmp);
    harness["ensureQingwuProfile"]();

    const upgradedContent = fs.readFileSync(patchPath, "utf-8");
    assert.doesNotMatch(upgradedContent, /\[\]\s*-/, "不得生成含有 [] 与序列拼接的非法 YAML");
    assert.match(upgradedContent, /id:\s*web/, "应当正规化包含 id: web 节点");
    assert.match(upgradedContent, /searchProvider:\s*deepseek-search-api/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("用户已定制的存量配置文件保持绝对原样，绝不擅自修改", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-test-profile-"));
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const initialPatch = [
      "# 青梧专属 profile 补丁层",
      "- id: agent-default-model",
      '  name: "@deepseek-ai/dsh-agent-default-model"',
      "  config:",
      "    provider: opencodex",
      "    model: google-antigravity/gemini-3.8-flash",
      "- id: permission",
      '  name: "@deepseek-ai/dsh-permission-presets"',
      "  config:",
      "    defaultPreset: danger-full-access",
    ].join("\n");
    const patchPath = path.join(tmp, "cordis.patch.yml");
    fs.writeFileSync(patchPath, initialPatch);

    const harness = setupHarness(tmp);
    harness["ensureQingwuProfile"]();

    // 用户已定制的配置文件必须保持一模一样，绝不擅自追加或覆盖
    assert.equal(fs.readFileSync(patchPath, "utf-8"), initialPatch);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("用户手动移除 web 后的文件在后续启动中绝对不再重新追加", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-test-profile-"));
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const userModifiedPatch = '[{ id: permission, config: { model: test } }]\n';
    const patchPath = path.join(tmp, "cordis.patch.yml");
    fs.writeFileSync(patchPath, userModifiedPatch);

    const harness = setupHarness(tmp);
    harness["ensureQingwuProfile"]();

    // 用户已手动移除 web 的配置必须完整尊重，绝不可重复追加
    assert.equal(fs.readFileSync(patchPath, "utf-8"), userModifiedPatch);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("若用户已存在自定义 web 配置，则保持原有设置不予覆盖", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-test-profile-"));
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const customPatch = [
      "- id: web",
      '  name: "@deepseek-ai/dsh-web"',
      "  config:",
      "    searchProvider: custom-search-api",
      "    fetchProvider: custom-fetch-api",
    ].join("\n");
    const patchPath = path.join(tmp, "cordis.patch.yml");
    fs.writeFileSync(patchPath, customPatch);

    const harness = setupHarness(tmp);
    harness["ensureQingwuProfile"]();

    assert.equal(fs.readFileSync(patchPath, "utf-8"), customPatch, "用户自定义配置必须原样保留");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
