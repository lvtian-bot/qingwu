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

test("老版空配置文档（带注释与 []）平滑正规化升级为合法 YAML", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-test-profile-"));
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const legacyEmptyPatch = "# 青梧专属 profile 补丁层\n[]\n";
    const patchPath = path.join(tmp, "cordis.patch.yml");
    fs.writeFileSync(patchPath, legacyEmptyPatch);

    const harness = setupHarness(tmp);
    harness["ensureQingwuProfile"]();

    const backupPath = `${patchPath}.bak`;
    assert.ok(fs.existsSync(backupPath), "应当生成 .bak 安全备份文件");
    assert.equal(fs.readFileSync(backupPath, "utf-8"), legacyEmptyPatch);

    const upgradedContent = fs.readFileSync(patchPath, "utf-8");
    assert.doesNotMatch(upgradedContent, /\[\]\s*-/, "不得生成含有 [] 与序列拼接的非法 YAML");
    assert.match(upgradedContent, /id:\s*web/, "应当正规化包含 id: web 节点");
    assert.match(upgradedContent, /searchProvider:\s*deepseek-search-api/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("老用户存量配置安全平滑升级：保留已有模型配置，备份并安全追加新版搜索", () => {
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

    const backupPath = `${patchPath}.bak`;
    assert.ok(fs.existsSync(backupPath), "应当生成 .bak 安全备份文件");
    assert.equal(fs.readFileSync(backupPath, "utf-8"), initialPatch, "备份内容必须与原始配置一致");

    const upgradedContent = fs.readFileSync(patchPath, "utf-8");
    assert.match(upgradedContent, /agent-default-model/, "老用户的默认模型必须保留");
    assert.match(upgradedContent, /google-antigravity\/gemini-3.8-flash/, "老用户的模型选择必须保留");
    assert.match(upgradedContent, /permission/, "老用户的权限配置必须保留");
    assert.match(upgradedContent, /id:\s*web/, "应当追加 id: web 节点");
    assert.match(upgradedContent, /deepseek-search-api/, "应当追加新版搜索配置");
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

    assert.equal(fs.existsSync(`${patchPath}.bak`), false, "未发生改动时不应产生备份文件");
    assert.equal(fs.readFileSync(patchPath, "utf-8"), customPatch, "用户自定义配置必须原样保留");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("若用户配置带有行尾注释，仍可精准识别并不重复追加", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-test-profile-"));
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const commentedCustomPatch = [
      "- id: web # 用户自定义搜索",
      '  name: "@deepseek-ai/dsh-web"',
      "  config:",
      "    searchProvider: custom-search-api",
      "    fetchProvider: custom-fetch-api",
    ].join("\n");
    const patchPath = path.join(tmp, "cordis.patch.yml");
    fs.writeFileSync(patchPath, commentedCustomPatch);

    const harness = setupHarness(tmp);
    harness["ensureQingwuProfile"]();

    assert.equal(fs.existsSync(`${patchPath}.bak`), false, "带行尾注释时不应产生备份文件");
    assert.equal(fs.readFileSync(patchPath, "utf-8"), commentedCustomPatch, "带行尾注释的配置必须原样保留");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
