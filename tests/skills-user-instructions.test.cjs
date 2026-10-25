const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadTs } = require("./helpers/load-ts.cjs");

const previousDshHome = process.env.DSH_HOME;
const previousAgentsHome = process.env.DSH_AGENTS_HOME;

function makeHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(root, relative, frontmatter, body = "正文") {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}\n`, "utf-8");
}

function setupSkillsModule() {
  return loadTs("src/main/skills.ts", {
    electron: {
      app: { getPath: (name) => (name === "home" ? os.homedir() : os.tmpdir()) },
      shell: { openPath: async () => "" },
    },
  });
}

function setupInstructionsModule() {
  return loadTs("src/main/user-instructions.ts");
}

test("技能枚举：按文件夹分别列出，行内注释正确解析，非法文件跳过", () => {
  const dshHome = makeHome("qingwu-skills-dsh-");
  const agentsHome = makeHome("qingwu-skills-agents-");
  const workA = makeHome("qingwu-skills-wsa-");
  const workB = makeHome("qingwu-skills-wsb-");
  process.env.DSH_HOME = dshHome;
  process.env.DSH_AGENTS_HOME = agentsHome;
  try {
    // 用户级 agents 文件夹：行内注释（引擎合法标量）、平铺形态、多行 description
    writeSkill(path.join(agentsHome, "skills"), "planner/SKILL.md", "name: planner # 规划助手\ndescription: agents 版规划");
    writeSkill(path.join(agentsHome, "skills"), "flat-note.md", "name: flat-note\ndescription: 平铺技能");
    writeSkill(
      path.join(agentsHome, "skills"),
      "multi-line/SKILL.md",
      "name: multi-line\ndescription: |\n  第一行说明\n  第二行说明",
    );
    // 用户级 dsh 文件夹：同名技能不去重，各文件夹保留自己的条目
    writeSkill(path.join(dshHome, "skills"), "planner/SKILL.md", "name: planner\ndescription: dsh 版规划");
    // 引擎会跳过的形态：缺 description、名称非法
    writeSkill(path.join(dshHome, "skills"), "broken/SKILL.md", "name: broken");
    writeSkill(path.join(dshHome, "skills"), "BadName/SKILL.md", "name: BadName\ndescription: 非法名称");

    // 项目级：两个文件夹分别列出（无技能的也返回空列表）
    writeSkill(path.join(workA, ".dsh", "skills"), "proj-tool/SKILL.md", "name: proj-tool\ndescription: 项目 dsh 版");
    writeSkill(path.join(workB, ".agents", "skills"), "only-agents/SKILL.md", "name: only-agents\ndescription: 仅 agents 项目技能");

    const { listLocalSkills } = setupSkillsModule();
    const snapshot = listLocalSkills([
      { workspaceId: "ws-a", title: "项目A", path: workA },
      { workspaceId: "ws-b", title: "项目B", path: workB },
    ]);

    assert.equal(snapshot.user.length, 2);
    const agentsFolder = snapshot.user[0];
    const dshFolder = snapshot.user[1];
    assert.equal(agentsFolder.label.endsWith("/skills"), true);
    assert.deepEqual(
      agentsFolder.skills.map((skill) => skill.name),
      ["flat-note", "multi-line", "planner"],
    );
    const planner = agentsFolder.skills.find((skill) => skill.name === "planner");
    assert.equal(planner.description, "agents 版规划");
    const multiLine = agentsFolder.skills.find((skill) => skill.name === "multi-line");
    assert.equal(multiLine.description, "第一行说明\n第二行说明\n");
    assert.deepEqual(
      dshFolder.skills.map((skill) => skill.name),
      ["planner"],
    );
    assert.equal(dshFolder.skills[0].description, "dsh 版规划");

    assert.equal(snapshot.projects.length, 2);
    const projectA = snapshot.projects[0];
    assert.equal(projectA.title, "项目A");
    assert.deepEqual(
      projectA.folders.map((folder) => folder.label),
      [".dsh/skills", ".agents/skills"],
    );
    assert.deepEqual(
      projectA.folders[0].skills.map((skill) => skill.name),
      ["proj-tool"],
    );
    assert.deepEqual(projectA.folders[1].skills, []);
    const projectB = snapshot.projects[1];
    assert.deepEqual(
      projectB.folders[1].skills.map((skill) => skill.name),
      ["only-agents"],
    );
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousDshHome;
    if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = previousAgentsHome;
    for (const dir of [dshHome, agentsHome, workA, workB]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("技能枚举：目录缺失时各文件夹返回空列表，工作区仍全部返回", () => {
  const dshHome = makeHome("qingwu-skills-empty-");
  process.env.DSH_HOME = dshHome;
  process.env.DSH_AGENTS_HOME = path.join(dshHome, "absent-agents");
  const workEmpty = makeHome("qingwu-skills-wse-");
  try {
    const { listLocalSkills } = setupSkillsModule();
    const snapshot = listLocalSkills([
      { workspaceId: "ws", title: "空项目", path: workEmpty },
    ]);
    assert.equal(snapshot.user.length, 2);
    for (const folder of snapshot.user) assert.deepEqual(folder.skills, []);
    assert.equal(snapshot.projects.length, 1);
    assert.equal(snapshot.projects[0].title, "空项目");
    for (const folder of snapshot.projects[0].folders) {
      assert.deepEqual(folder.skills, []);
    }
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousDshHome;
    if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = previousAgentsHome;
    for (const dir of [dshHome, workEmpty]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("用户级指令：缺失返回空，保存后读回一致，超限拒绝写入", async () => {
  const dshHome = makeHome("qingwu-instr-");
  process.env.DSH_HOME = dshHome;
  try {
    const { getUserInstructions, saveUserInstructions, USER_INSTRUCTIONS_MAX_BYTES } =
      setupInstructionsModule();

    const initial = getUserInstructions();
    assert.equal(initial.content, "");
    assert.equal(initial.sizeBytes, 0);
    assert.equal(initial.maxBytes, 64 * 1024);

    const saved = await saveUserInstructions("第一条：回复使用中文\n");
    assert.equal(saved.sizeBytes, Buffer.byteLength("第一条：回复使用中文\n", "utf8"));
    const reread = getUserInstructions();
    assert.equal(reread.content, "第一条：回复使用中文\n");
    assert.equal(
      fs.readFileSync(path.join(dshHome, "AGENTS.md"), "utf-8"),
      "第一条：回复使用中文\n",
    );

    const oversized = "a".repeat(USER_INSTRUCTIONS_MAX_BYTES + 1);
    await assert.rejects(() => saveUserInstructions(oversized));
    assert.equal(getUserInstructions().content, "第一条：回复使用中文\n");
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousDshHome;
    fs.rmSync(dshHome, { recursive: true, force: true });
  }
});
