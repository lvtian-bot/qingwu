import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { resolveDshHome } from "./dsh-paths";
import type {
  ProjectSkillGroup,
  SkillDisplayInfo,
  SkillsSnapshot,
} from "../shared/types";

/**
 * 设置页技能分区：主进程直接枚举技能目录，不依赖引擎进程与会话上下文。
 *
 * 与引擎 dsh-skill-filesystem 的发现语义对齐（差异范围见模块文档）：
 * - 根目录：用户级 $DSH_HOME/skills、$DSH_AGENTS_HOME/skills（默认 ~/.agents/skills）；
 *   项目级 <项目>/.dsh/skills、<项目>/.agents/skills（项目即青梧工作区）。
 * - 技能形态：子目录/SKILL.md，或技能根下单个 .md 文件。
 * - 同名技能 rank 小者胜：项目 .dsh/skills → 项目 .agents/skills →
 *   用户 .dsh/skills → 用户 .agents/skills，列表只显示生效的一份。
 * - frontmatter 缺 name/description、name 非法或解析失败的文件跳过（引擎同样跳过）。
 * 展示层只解析 name/description/whenToUse 三个标量字段，复杂 YAML（嵌套、
 * 锚点等罕见写法）可能被跳过，此时列表与引擎运行时视图存在该类差异。
 */

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface WorkspaceRef {
  workspaceId: string;
  title: string;
  path: string;
}

interface SkillCandidate extends SkillDisplayInfo {
  rank: number;
}

/** 引擎同名裁决顺序：数值小者优先（对齐 dsh-skill-filesystem 的 rank 常量）。 */
const RANK_PROJECT_DSH = 100;
const RANK_PROJECT_AGENTS = 200;
const RANK_USER_DSH = 400;
const RANK_USER_AGENTS = 500;

function resolveAgentsHome(): string {
  return process.env.DSH_AGENTS_HOME || path.join(os.homedir(), ".agents");
}

/** 从单个技能文件提取展示字段；返回 undefined 表示按引擎规则跳过。 */
function parseSkillDisplayFields(filePath: string): SkillDisplayInfo | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
  const fields = parseDisplayFrontmatter(raw);
  if (!fields) return undefined;
  return fields;
}

/**
 * 轻量 frontmatter 解析：只提取 name/description/whenToUse 三个标量字段。
 * 支持 `---` 起止块、顶层单行标量（含单双引号剥离）与 | / > 多行块；
 * 结构不满足时返回 undefined，调用方按引擎行为跳过该技能。
 */
function parseDisplayFrontmatter(
  raw: string,
): SkillDisplayInfo | undefined {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return undefined;
  const blockLines: string[] = [];
  let closed = false;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trimEnd() === "---") {
      closed = true;
      break;
    }
    blockLines.push(lines[i]);
  }
  if (!closed) return undefined;

  const scalars = new Map<string, string>();
  let currentKey: string | null = null;
  let blockStyle = "";
  let blockParts: string[] = [];
  const flush = () => {
    if (currentKey && !scalars.has(currentKey) && blockParts.length) {
      scalars.set(currentKey, blockParts.join(blockStyle === ">" ? " " : "\n"));
    }
    currentKey = null;
    blockParts = [];
  };
  for (const line of blockLines) {
    const topMatch = /^([A-Za-z][\w-]*)\s*:(.*)$/.exec(line);
    if (topMatch) {
      flush();
      const key = topMatch[1];
      const rest = topMatch[2].trim();
      if (rest === "" || rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
        currentKey = key;
        blockStyle = rest.startsWith(">") ? ">" : "|";
      } else {
        scalars.set(key, unquoteScalar(rest));
      }
      continue;
    }
    if (currentKey) {
      const indentPart = line.replace(/^\s+/, "");
      if (indentPart && !indentPart.startsWith("#") && !/^-\s/.test(indentPart)) {
        blockParts.push(indentPart.trim());
      }
    }
  }
  flush();

  const name = scalars.get("name");
  const description = scalars.get("description");
  if (!name || !description) return undefined;
  if (!SKILL_NAME_PATTERN.test(name)) return undefined;
  const whenToUse = scalars.get("whenToUse");
  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
  };
}

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** 枚举一个技能根：子目录读 SKILL.md，单个 .md 文件读自身；缺失根视为空。 */
function listRootSkills(rootPath: string, rank: number): SkillCandidate[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: SkillCandidate[] = [];
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
    if (info) candidates.push({ ...info, rank });
  }
  return candidates;
}

/** 同名技能取 rank 最小的一份；最终按名称排序。 */
function mergeCandidates(groups: SkillCandidate[][]): SkillDisplayInfo[] {
  const byName = new Map<string, SkillCandidate>();
  for (const group of groups) {
    for (const candidate of group) {
      const existing = byName.get(candidate.name);
      if (!existing || candidate.rank < existing.rank) {
        byName.set(candidate.name, candidate);
      }
    }
  }
  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, description, whenToUse }) => ({
      name,
      description,
      ...(whenToUse !== undefined ? { whenToUse } : {}),
    }));
}

/** 枚举用户级与各项目技能目录，供设置页技能分区展示。 */
export function listLocalSkills(workspaces: WorkspaceRef[]): SkillsSnapshot {
  const dshHome = resolveDshHome();
  const agentsHome = resolveAgentsHome();
  const user = mergeCandidates([
    listRootSkills(path.join(dshHome, "skills"), RANK_USER_DSH),
    listRootSkills(path.join(agentsHome, "skills"), RANK_USER_AGENTS),
  ]);

  const projects: ProjectSkillGroup[] = [];
  const seenWorkspace = new Set<string>();
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace.path !== "string" || !workspace.path) continue;
    const key = typeof workspace.workspaceId === "string" ? workspace.workspaceId : workspace.path;
    if (seenWorkspace.has(key)) continue;
    seenWorkspace.add(key);
    const skills = mergeCandidates([
      listRootSkills(path.join(workspace.path, ".dsh", "skills"), RANK_PROJECT_DSH),
      listRootSkills(path.join(workspace.path, ".agents", "skills"), RANK_PROJECT_AGENTS),
    ]);
    if (!skills.length) continue;
    projects.push({
      workspaceId: key,
      title: typeof workspace.title === "string" && workspace.title ? workspace.title : workspace.path,
      path: workspace.path,
      skills,
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
