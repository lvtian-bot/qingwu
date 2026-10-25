import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { parse as parseYaml } from "yaml";
import { resolveDshHome } from "./dsh-paths";
import type {
  ProjectSkillGroup,
  SkillDisplayInfo,
  SkillFolderGroup,
  SkillsSnapshot,
} from "../shared/types";

/**
 * 设置页技能分区：主进程直接枚举技能目录，不依赖引擎进程与会话上下文。
 * 与引擎 dsh-skill-filesystem 的发现语义对齐：
 * - 技能根目录：用户级 $DSH_HOME/skills、$DSH_AGENTS_HOME/skills；项目级 <项目>/.dsh/skills、<项目>/.agents/skills。
 * - 技能形态：子目录/SKILL.md 或技能根下单个 .md 文件。
 * - frontmatter 经 yaml 解析（与引擎同一依赖），name/description 必填、name 须为
 *   kebab-case；缺字段、名称非法或解析失败的文件跳过（引擎同样跳过）。
 * 各文件夹独立列出、不做跨文件夹去重（引擎的同名裁决发生在加载期，目录视图
 * 保留文件夹来源）；项目级固定返回已打开工作区（无技能时为空列表），让用户
 * 确认项目已被识别。
 */

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 共享 agent 配置根：优先 DSH_AGENTS_HOME，否则用户主目录下的 .agents（对齐引擎 resolveAgentsHome）。 */
function resolveAgentsHome(): string {
  return process.env.DSH_AGENTS_HOME || path.join(os.homedir(), ".agents");
}

export interface WorkspaceRef {
  workspaceId: string;
  title: string;
  path: string;
}

/** 从单个技能文件提取展示字段；返回 undefined 表示按引擎规则跳过。 */
function parseSkillDisplayFields(filePath: string): SkillDisplayInfo | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
  const block = splitFrontmatterBlock(raw);
  if (block === undefined) return undefined;
  let data: unknown;
  try {
    data = parseYaml(block);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  const fields = data as Record<string, unknown>;
  const name = nonEmptyString(fields.name);
  const description = nonEmptyString(fields.description);
  if (!name || !description) return undefined;
  if (!SKILL_NAME_PATTERN.test(name)) return undefined;
  const whenToUse = nonEmptyString(fields.whenToUse);
  return { name, description, ...(whenToUse ? { whenToUse } : {}) };
}

/** 提取 `---` 起止的 frontmatter 块；无起始或无闭合行均视为无有效 frontmatter。 */
function splitFrontmatterBlock(raw: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.replace(/\r$/, "") !== "---") return undefined;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, "") === "---") {
      return lines.slice(1, i).join("\n");
    }
  }
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 枚举一个技能根：子目录读 SKILL.md，单个 .md 文件读自身；缺失根视为空。 */
function listRootSkills(rootPath: string): SkillDisplayInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: SkillDisplayInfo[] = [];
  const ordered = entries
    .filter((entry) => entry.name !== ".system")
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of ordered) {
    let filePath: string | undefined;
    if (entry.isDirectory()) {
      filePath = path.join(rootPath, entry.name, "SKILL.md");
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      filePath = path.join(rootPath, entry.name);
    }
    if (!filePath) continue;
    const info = parseSkillDisplayFields(filePath);
    if (info) skills.push(info);
  }
  return skills;
}

/** 显示路径：用户主目录前缀缩写为 ~，分隔符统一为 /。 */
function displayPath(absolute: string): string {
  const normalized = absolute.split(path.sep).join("/");
  const home = os.homedir().split(path.sep).join("/").replace(/\/+$/, "");
  if (home && normalized.startsWith(`${home}/`)) {
    return `~${normalized.slice(home.length)}`;
  }
  return normalized;
}

function folderGroup(rootPath: string, label?: string): SkillFolderGroup {
  return {
    path: rootPath,
    label: label ?? displayPath(rootPath),
    skills: listRootSkills(rootPath),
  };
}

/** 枚举用户级与各项目技能目录，供设置页技能分区展示。 */
export function listLocalSkills(workspaces: WorkspaceRef[]): SkillsSnapshot {
  const dshHome = resolveDshHome();
  const agentsHome = resolveAgentsHome();
  const user = [
    folderGroup(path.join(agentsHome, "skills")),
    folderGroup(path.join(dshHome, "skills")),
  ];

  const projects: ProjectSkillGroup[] = [];
  const seenWorkspace = new Set<string>();
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace.path !== "string" || !workspace.path) continue;
    const key = typeof workspace.workspaceId === "string" ? workspace.workspaceId : workspace.path;
    if (seenWorkspace.has(key)) continue;
    seenWorkspace.add(key);
    projects.push({
      workspaceId: key,
      title: typeof workspace.title === "string" && workspace.title ? workspace.title : workspace.path,
      path: workspace.path,
      folders: [
        folderGroup(path.join(workspace.path, ".dsh", "skills"), ".dsh/skills"),
        folderGroup(path.join(workspace.path, ".agents", "skills"), ".agents/skills"),
      ],
    });
  }

  return { user, projects };
}

/** 打开（不存在时先创建）用户级技能文件夹，返回 shell.openPath 的结果。 */
export async function openUserSkillsFolder(): Promise<string> {
  const dir = path.join(resolveAgentsHome(), "skills");
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
}
