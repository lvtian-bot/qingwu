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

test("技能枚举：分用户级/项目级列出，同名按 rank 裁决，非法文件跳过", () => {
  const dshHome = makeHome("qingwu-skills-dsh-");
  const agentsHome = makeHome("qingwu-skills-agents-");
  const workA = makeHome("qingwu-skills-wsa-");
  const workB = makeHome("qingwu-skills-wsb-");
  process.env.DSH_HOME = dshHome;
  process.env.DSH_AGENTS_HOME = agentsHome;
  try {
    // 用户级：目录型 + 平铺型；agents 下同名技能被 dsh 版覆盖
    writeSkill(path.join(dshHome, "skills"), "planner/SKILL.md", 'name: planner\ndescription: "dsh 版规划"');
    writeSkill(path.join(dshHome, "skills"), "flat-note.md", "name: flat-note\ndescription: 平铺技能");
    writeSkill(path.join(agentsHome, "skills"), "planner/SKILL.md", "name: planner\ndescription: agents 版规划");
    // 多行 description（| 块）
    writeSkill(
      path.join(agentsHome, "skills"),
      "multi-line/SKILL.md",
      "name: multi-line\ndescription: |\n  第一行说明\n  第二行说明",
    );
    // 项目级：同名裁决取 .dsh/skills（rank 100 < 200）
    writeSkill(path.join(workA, ".dsh", "skills"), "proj-tool/SKILL.md", "name: proj-tool\ndescription: 项目 dsh 版");
    writeSkill(path.join(workA, ".agents", "skills"), "proj-tool/SKILL.md", "name: proj-tool\ndescription: 项目 agents 版");
    writeSkill(path.join(workB, ".agents", "skills"), "only-agents/SKILL.md", "name: only-agents\ndescription: 仅 agents 项目技能");
    // 引擎会跳过的形态：缺 description、名称非法
    writeSkill(path.join(dshHome, "skills"), "broken/SKILL.md", "name: broken");
    writeSkill(path.join(dshHome, "skills"), "BadName/SKILL.md", "name: BadName\ndescription: 非法名称");

    const { listLocalSkills } = setupSkillsModule();
    const snapshot = listLocalSkills([
      { workspaceId: "ws-a", title: "项目A", path: workA },
      { workspaceId: "ws-b", title: "项目B", path: workB },
    ]);

    assert.deepEqual(
      snapshot.user.map((skill) => skill.name),
      ["flat-note", "multi-line", "planner"],
    );
    const planner = snapshot.user.find((skill) => skill.name === "planner");
    assert.equal(planner.description, "dsh 版规划");
    const multiLine = snapshot.user.find((skill) => skill.name === "multi-line");
    assert.equal(multiLine.description, "第一行说明\n第二行说明");

    assert.equal(snapshot.projects.length, 2);
    assert.equal(snapshot.projects[0].title, "项目A");
    const projTool = snapshot.projects[0].skills.find((skill) => skill.name === "proj-tool");
    assert.equal(projTool.description, "项目 dsh 版");
    assert.deepEqual(
      snapshot.projects[1].skills.map((skill) => skill.name),
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

test("技能枚举：目录缺失视为空，无技能项目不分组", () => {
  const dshHome = makeHome("qingwu-skills-empty-");
  process.env.DSH_HOME = dshHome;
  process.env.DSH_AGENTS_HOME = path.join(dshHome, "absent-agents");
  const workEmpty = makeHome("qingwu-skills-wse-");
  try {
    const { listLocalSkills } = setupSkillsModule();
    const snapshot = listLocalSkills([{ workspaceId: "ws", title: "空项目", path: workEmpty }]);
    assert.deepEqual(snapshot.user, []);
    assert.deepEqual(snapshot.projects, []);
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
