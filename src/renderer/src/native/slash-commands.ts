import type { CommandDescriptor, SkillDescriptor } from './protocol';

export type SlashSection = 'add' | 'commands' | 'skills';

/** 斜杠命令菜单中展示的一项数据。 */
export interface SlashCommandItem {
  /** 命令小写名称（无斜杠），如 'compact'、'plan'、技能名。 */
  name: string;
  /** 中文标签展示名，如 '计划'、'压缩'、技能名。 */
  label: string;
  /** 描述文案（面向人类可读）。 */
  description: string;
  /** 所属分组（对齐官方 UI：'add' 为添加，'commands' 为指令，'skills' 为技能）。 */
  section: SlashSection;
  /** 搜索别名词典（中文名称、拼音简写等）。 */
  tokens: string[];
  /** 自由输入参数的提示占位，如 '目标描述'。有 hint 时表示需要参数。 */
  hint?: string;
  /** 是否接受图片等附件提交。缺省为 false。 */
  attachments?: boolean;
  /** 是否为前端自处理命令（例如唤起前端模型选择弹层）。 */
  isClient?: boolean;
  /** 是否为技能（通过普通消息 Prompt 发送触发，而非宿主 RPC 命令）。 */
  isSkill?: boolean;
  /** 技能是否允许模型主动调用。 */
  modelInvocable?: boolean;
}

/** 触发检测结果（对齐官方 dsh-client-ui-input-trigger）。 */
export interface SlashTriggerResult {
  active: boolean;
  query: string;
  triggerChar: string;
  position: 'leading' | 'inline';
  span: { start: number; end: number };
}

/** 官方已知命令的配置字典（对齐 dsh-client-ui-commands）。 */
export interface BuiltinCommandMeta {
  label: string;
  description: string;
  section: SlashSection;
  tokens: string[];
  hint?: string;
}

export const BUILTIN_COMMAND_METAS: Record<string, BuiltinCommandMeta> = {
  goal: {
    label: '目标',
    description: '设置或查看长期任务目标',
    section: 'add',
    tokens: ['目标', 'mb', 'mubiao'],
    hint: '目标描述',
  },
  plan: {
    label: '计划',
    description: '进入或退出计划模式',
    section: 'add',
    tokens: ['计划', 'jh', 'jihua'],
  },
  feedback: {
    label: '反馈',
    description: '发送关于当前会话的反馈',
    section: 'add',
    tokens: ['反馈', 'fk', 'fankui'],
  },
  compact: {
    label: '压缩',
    description: '压缩以上对话内容',
    section: 'commands',
    tokens: ['压缩', 'ys', 'yasuo'],
  },
  permission: {
    label: '权限',
    description: '切换权限预设（沙箱模式与审批策略）',
    section: 'commands',
    tokens: ['权限', 'qx', 'quanxian'],
  },
  model: {
    label: '模型',
    description: '切换当前会话或默认模型',
    section: 'commands',
    tokens: ['模型', 'mx', 'moxing'],
  },
  export: {
    label: '下载日志',
    description: '将当前会话内容导出为 ZIP',
    section: 'commands',
    tokens: ['导出', '下载', '下载日志', 'dc', 'daochu'],
  },
};

/** 官方预设排序顺序。未列出的命令归入 commands 并按原样追加在后。 */
export const SECTION_ORDER: Record<SlashSection, string[]> = {
  add: ['goal', 'plan', 'feedback'],
  commands: ['compact', 'permission', 'model', 'export'],
  skills: [],
};

/** 纯前端命令扩展：如 /model 用于呼出模型与推理档位面板。 */
export const CLIENT_COMMANDS: SlashCommandItem[] = [
  {
    name: 'model',
    label: BUILTIN_COMMAND_METAS.model.label,
    description: BUILTIN_COMMAND_METAS.model.description,
    section: BUILTIN_COMMAND_METAS.model.section,
    tokens: BUILTIN_COMMAND_METAS.model.tokens,
    isClient: true,
  },
];

/** 默认基线命令表（确保在未选定会话或离线状态下也有全量内置命令展示）。 */
export const BASELINE_HOST_COMMANDS: SlashCommandItem[] = [
  {
    name: 'goal',
    label: BUILTIN_COMMAND_METAS.goal.label,
    description: BUILTIN_COMMAND_METAS.goal.description,
    section: 'add',
    tokens: BUILTIN_COMMAND_METAS.goal.tokens,
    hint: BUILTIN_COMMAND_METAS.goal.hint,
  },
  {
    name: 'plan',
    label: BUILTIN_COMMAND_METAS.plan.label,
    description: BUILTIN_COMMAND_METAS.plan.description,
    section: 'add',
    tokens: BUILTIN_COMMAND_METAS.plan.tokens,
  },
  {
    name: 'feedback',
    label: BUILTIN_COMMAND_METAS.feedback.label,
    description: BUILTIN_COMMAND_METAS.feedback.description,
    section: 'add',
    tokens: BUILTIN_COMMAND_METAS.feedback.tokens,
  },
  {
    name: 'compact',
    label: BUILTIN_COMMAND_METAS.compact.label,
    description: BUILTIN_COMMAND_METAS.compact.description,
    section: 'commands',
    tokens: BUILTIN_COMMAND_METAS.compact.tokens,
  },
  {
    name: 'permission',
    label: BUILTIN_COMMAND_METAS.permission.label,
    description: BUILTIN_COMMAND_METAS.permission.description,
    section: 'commands',
    tokens: BUILTIN_COMMAND_METAS.permission.tokens,
  },
  {
    name: 'export',
    label: BUILTIN_COMMAND_METAS.export.label,
    description: BUILTIN_COMMAND_METAS.export.description,
    section: 'commands',
    tokens: BUILTIN_COMMAND_METAS.export.tokens,
  },
];

/** 将上游 CommandDescriptor 规范化并补充中文信息。 */
export function normalizeCommand(descriptor: CommandDescriptor): SlashCommandItem {
  const name = descriptor.name.toLowerCase();
  const meta = BUILTIN_COMMAND_METAS[name];

  return {
    name,
    label: meta?.label || descriptor.name,
    description: meta?.description || descriptor.description,
    section: meta?.section || 'commands',
    tokens: meta?.tokens || [],
    hint: descriptor.input?.hint ?? meta?.hint,
    attachments: descriptor.input?.attachments,
    isClient: false,
  };
}

/** 将上游 SkillDescriptor 规范化为斜杠候选。 */
export function normalizeSkill(skill: SkillDescriptor): SlashCommandItem {
  const desc =
    skill.modelInvocable === false
      ? `仅限用户 · ${skill.description}`
      : skill.description;

  return {
    name: skill.name.toLowerCase(),
    label: skill.name,
    description: desc,
    section: 'skills',
    tokens: [skill.name.toLowerCase()],
    isSkill: true,
    modelInvocable: skill.modelInvocable,
  };
}

/**
 * 按照官方规范对命令列表进行分组并排序。
 * 顺序：
 * 1. 'add' 分组按 SECTION_ORDER.add 排序；
 * 2. 'commands' 分组按 SECTION_ORDER.commands 排序；
 * 3. 其他未列出的宿主命令依次追加在 'commands' 之后；
 * 4. 'skills' 分组按字母顺序排序。
 */
export function sortCommandItems(items: SlashCommandItem[]): SlashCommandItem[] {
  const SECTION_WEIGHTS: Record<SlashSection, number> = {
    add: 0,
    commands: 1,
    skills: 2,
  };

  const addOrder = new Map(SECTION_ORDER.add.map((k, i) => [k, i]));
  const cmdOrder = new Map(SECTION_ORDER.commands.map((k, i) => [k, i]));

  return [...items].sort((a, b) => {
    if (a.section !== b.section) {
      return SECTION_WEIGHTS[a.section] - SECTION_WEIGHTS[b.section];
    }

    if (a.section === 'add') {
      const idxA = addOrder.get(a.name) ?? 999;
      const idxB = addOrder.get(b.name) ?? 999;
      return idxA - idxB;
    }

    if (a.section === 'commands') {
      const idxA = cmdOrder.get(a.name) ?? 999;
      const idxB = cmdOrder.get(b.name) ?? 999;
      if (idxA !== idxB) return idxA - idxB;
      return a.name.localeCompare(b.name);
    }

    return a.name.localeCompare(b.name);
  });
}

/**
 * 将宿主命令、客户端命令和技能合并、去重并排序（宿主命令优先）。
 * 当宿主命令列表为空（如未进入会话）时，使用 BASELINE_HOST_COMMANDS 兜底。
 */
export function mergeCommands(
  hostDescriptors: CommandDescriptor[],
  clientCommands: SlashCommandItem[] = CLIENT_COMMANDS,
  skills: SkillDescriptor[] = [],
): SlashCommandItem[] {
  const items: SlashCommandItem[] = [];
  const seen = new Set<string>();

  const sourceDescriptors =
    hostDescriptors.length > 0 ? hostDescriptors : [];

  for (const desc of sourceDescriptors) {
    const item = normalizeCommand(desc);
    items.push(item);
    seen.add(item.name);
  }

  // 兜底基线（仅当尚未拉取到宿主命令时注入基线）
  if (sourceDescriptors.length === 0) {
    for (const base of BASELINE_HOST_COMMANDS) {
      if (!seen.has(base.name)) {
        items.push(base);
        seen.add(base.name);
      }
    }
  }

  for (const client of clientCommands) {
    if (!seen.has(client.name)) {
      items.push(client);
      seen.add(client.name);
    }
  }

  for (const skill of skills) {
    const name = skill.name.toLowerCase();
    // 官方规范：如果 skill 与宿主命令同名，优先解析为命令
    if (!seen.has(name)) {
      items.push(normalizeSkill(skill));
      seen.add(name);
    }
  }

  return sortCommandItems(items);
}

/** 判断字符是否为命令触发前缀（半角斜杠 /、中文顿号 、 或全角斜杠 ／）。 */
export function isSlashTriggerChar(ch: string): boolean {
  return ch === '/' || ch === '、' || ch === '／';
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const WHITESPACE = /\s/u;

/**
 * 官方词边界校验：
 * 1. 在文本开头；
 * 2. 前一个字符是空白（空格或换行）；
 * 3. 前一个字符是标点符号（非普通单词字符）；
 * 4. 规避 URL：防范 'http:/' 或 '//' 内的斜杠。
 */
function boundaryOk(draft: string, index: number, char: string): boolean {
  if (index === 0) return true;
  const prev = draft.charAt(index - 1);
  if (WHITESPACE.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  if (char === '/') {
    if (prev === '/') return false;
    if (prev === ':' && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false;
  }
  return true;
}

/**
 * 对齐官方 dsh-client-ui-input-trigger 的触发检测。
 * 支持半角斜杠 /、中文顿号 、 和全角斜杠 ／。
 * 从光标位置往前扫描，按词边界判断是否处于命令联想状态。
 */
export function detectSlashTrigger(
  input: string,
  cursorPos?: number,
): SlashTriggerResult {
  const closed: SlashTriggerResult = {
    active: false,
    query: '',
    triggerChar: '',
    position: 'leading',
    span: { start: 0, end: 0 },
  };

  if (!input) return closed;

  const caret =
    cursorPos !== undefined && cursorPos >= 0 && cursorPos <= input.length
      ? cursorPos
      : input.length;

  for (let i = caret - 1; i >= 0; i--) {
    const ch = input.charAt(i);
    // 遇到空白字符（换行或空格），说明正在输入参数或触发字符在更前面，终止检测
    if (WHITESPACE.test(ch)) return closed;
    if (!isSlashTriggerChar(ch)) continue;
    if (!boundaryOk(input, i, ch)) continue;

    const isLeading = input.slice(0, i).trim().length === 0;
    return {
      active: true,
      query: input.slice(i + 1, caret).trim().toLowerCase(),
      triggerChar: ch,
      position: isLeading ? 'leading' : 'inline',
      span: {
        start: i,
        end: caret,
      },
    };
  }

  return closed;
}

/**
 * 根据 query 对命令列表进行加权过滤与排序。
 * 对齐官方规则：在 inline 位置只展示无需参数的命令（hint 为空）。
 */
export function filterSlashCommands(
  commands: SlashCommandItem[],
  query: string,
  position: 'leading' | 'inline' = 'leading',
): SlashCommandItem[] {
  // 官方规则：行内触发只显示无需参数的命令
  const pool =
    position === 'inline'
      ? commands.filter((c) => !c.hint)
      : commands;

  const q = query.trim().toLowerCase();
  if (!q) {
    return [...pool];
  }

  interface ScoredItem {
    item: SlashCommandItem;
    score: number;
  }

  const scored: ScoredItem[] = [];

  for (const cmd of pool) {
    const name = cmd.name.toLowerCase();
    const label = cmd.label.toLowerCase();
    const desc = cmd.description.toLowerCase();
    const tokens = (cmd.tokens || []).map((t) => t.toLowerCase());

    let score = 0;

    if (name.startsWith(q)) {
      score = Math.max(score, 100);
    } else if (label.startsWith(q) || tokens.some((t) => t.startsWith(q))) {
      score = Math.max(score, 90);
    } else if (name.includes(q)) {
      score = Math.max(score, 70);
    } else if (label.includes(q) || tokens.some((t) => t.includes(q))) {
      score = Math.max(score, 60);
    } else if (desc.includes(q)) {
      score = Math.max(score, 40);
    }

    if (score > 0) {
      scored.push({ item: cmd, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return pool.indexOf(a.item) - pool.indexOf(b.item);
  });

  return scored.map((s) => s.item);
}

/** 中文 token 到内置英文命令名的映射表。 */
const TOKEN_TO_BUILTIN_NAME: Record<string, string> = {
  目标: 'goal',
  计划: 'plan',
  反馈: 'feedback',
  压缩: 'compact',
  权限: 'permission',
  模型: 'model',
  导出: 'export',
  下载日志: 'export',
};

/**
 * 解析完整命令行（用于 leading 情况下 Enter 提交判定）。
 */
export function parseSlashLine(line: string): {
  name: string;
  args: string;
  hasArgs: boolean;
  rawInput: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed || !isSlashTriggerChar(trimmed[0])) return null;

  const match = /^[\\/、／]([a-z0-9_\u4e00-\u9fa5-]+)(?:[\t\n\r ](.*))?$/isu.exec(trimmed);
  if (!match) return null;

  const rawName = match[1].toLowerCase();
  const canonicalName = TOKEN_TO_BUILTIN_NAME[rawName] || rawName;
  const rawInput = match[2] ?? '';
  const args = rawInput.trim();

  return {
    name: canonicalName,
    args,
    hasArgs: rawInput.length > 0,
    rawInput,
  };
}
