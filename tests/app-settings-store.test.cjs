const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { loadTs } = require("./helpers/load-ts.cjs");

/**
 * 建立隔离目录与 electron 替身加载 SettingsManager。
 * dshHome 传入时同步注入 DSH_HOME 环境变量，未传入时删除该变量，
 * 保证设置存储与 harness 引擎启动解析到同一个数据根。
 */
function setup({ dshHome, userData, legacySettings }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-home-"));
  if (dshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = dshHome;
  const profileDir = path.join(dshHome ?? path.join(home, ".dsh"), "profiles", "qingwu");
  fs.mkdirSync(userData, { recursive: true });
  if (legacySettings) {
    fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify(legacySettings));
  }
  const { settings } = loadTs("src/main/settings.ts", {
    electron: {
      app: {
        getPath: (name) => (name === "userData" ? userData : home),
      },
    },
  });
  return { settings, home, profileDir };
}

function cleanupDirsWithEnv(dirs, previousDshHome) {
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

test("旧 userData 配置搬移到 dsh profile 目录并留档", () => {
  const previousDshHome = process.env.DSH_HOME;
  const dshHome = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-dsh-")), "data");
  const userData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-ud-")), "qingwu");
  try {
    const h = setup({
      dshHome,
      userData,
      legacySettings: { closeToTray: false, chatWidth: "wide" },
    });
    const all = h.settings.getAll();
    assert.equal(all.closeToTray, false);
    assert.equal(all.chatWidth, "wide");
    const migrated = path.join(h.profileDir, "app-settings.json");
    // 旧文件原样复制（保留原始字节，校验合并交给加载逻辑），行为经 getAll 补全默认值
    assert.deepEqual(JSON.parse(fs.readFileSync(migrated, "utf8")), {
      closeToTray: false,
      chatWidth: "wide",
    });
    // 旧文件改名留档，避免目标文件被清后旧值回灌
    assert.ok(fs.existsSync(path.join(userData, "settings.json.migrated")));
    assert.equal(fs.existsSync(path.join(userData, "settings.json")), false);
  } finally {
    cleanupDirsWithEnv([dshHome, userData], previousDshHome);
  }
});

test("profile 目录已有配置时不搬移旧值，非法档位回落默认", () => {
  const previousDshHome = process.env.DSH_HOME;
  const dshHome = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-dsh-")), "data");
  const userData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-ud-")), "qingwu");
  try {
    const h = setup({ dshHome, userData, legacySettings: { chatWidth: "narrow" } });
    // 先写一次形成 profile 现值，再在旧位置放置不同值，验证不再回灌
    h.settings.set("closeToTray", false);
    fs.writeFileSync(
      path.join(userData, "settings.json"),
      JSON.stringify({ closeToTray: true, chatWidth: "invalid" }),
    );
    const fresh = loadTs("src/main/settings.ts", {
      electron: { app: { getPath: (name) => (name === "userData" ? userData : home(h)) } },
    }).settings;
    const all = fresh.getAll();
    assert.equal(all.closeToTray, false);
    assert.equal(all.chatWidth, "narrow");
  } finally {
    cleanupDirsWithEnv([dshHome, userData], previousDshHome);
  }
});

// 取 setup 记录的用户主目录（供重复加载同一替身时复用）
function home(h) {
  return h.home;
}

test("无旧配置且未设置 DSH_HOME 时用默认值并写入用户主目录 profile", () => {
  const previousDshHome = process.env.DSH_HOME;
  const userData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-ud-")), "qingwu");
  try {
    const h = setup({ userData, legacySettings: null });
    const all = h.settings.getAll();
    assert.equal(all.closeToTray, true);
    assert.equal(all.notifyOnTaskFinished, true);
    assert.equal(all.transcriptView, "standard");
    h.settings.set("collapseProcess", true);
    const expected = path.join(h.home, ".dsh", "profiles", "qingwu", "app-settings.json");
    assert.equal(JSON.parse(fs.readFileSync(expected, "utf8")).collapseProcess, true);
  } finally {
    cleanupDirsWithEnv([userData], previousDshHome);
  }
});

test("transcriptView 默认 standard，支持四档，非法值回落，旧布尔值平滑迁移", () => {
  const previousDshHome = process.env.DSH_HOME;
  const userData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qingwu-ud-")), "qingwu");
  try {
    // 1. 无配置时默认 standard
    const h1 = setup({ userData, legacySettings: null });
    assert.equal(h1.settings.get("transcriptView"), "standard");

    // 2. 正常设置各合法档位
    for (const mode of ["compact", "detailed", "verbose", "standard"]) {
      h1.settings.set("transcriptView", mode);
      assert.equal(h1.settings.get("transcriptView"), mode);
    }

    // 3. 非法值加载时回落到 standard
    const configPath = path.join(h1.profileDir, "app-settings.json");
    fs.writeFileSync(configPath, JSON.stringify({ transcriptView: "invalid_mode" }), "utf8");
    const fresh1 = loadTs("src/main/settings.ts", {
      electron: { app: { getPath: (name) => (name === "userData" ? userData : h1.home) } },
    }).settings;
    assert.equal(fresh1.get("transcriptView"), "standard");

    // 4. 旧布尔配置迁移：collapseProcess: true -> standard
    fs.writeFileSync(configPath, JSON.stringify({ collapseProcess: true }), "utf8");
    const fresh2 = loadTs("src/main/settings.ts", {
      electron: { app: { getPath: (name) => (name === "userData" ? userData : h1.home) } },
    }).settings;
    assert.equal(fresh2.get("transcriptView"), "standard");

    // 5. 旧布尔配置迁移：collapseProcess: false -> verbose
    fs.writeFileSync(configPath, JSON.stringify({ collapseProcess: false }), "utf8");
    const fresh3 = loadTs("src/main/settings.ts", {
      electron: { app: { getPath: (name) => (name === "userData" ? userData : h1.home) } },
    }).settings;
    assert.equal(fresh3.get("transcriptView"), "verbose");
  } finally {
    cleanupDirsWithEnv([userData], previousDshHome);
  }
});
