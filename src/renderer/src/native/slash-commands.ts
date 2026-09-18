import type { CommandDescriptor } from './protocol';

/** 斜杠命令菜单中展示的一项数据。 */
export interface SlashCommandItem {
  /** 命令小写名称（无斜杠），如 'compact'、'plan'。 */
  name: string;
  /** 描述文案（面向人类可读）。 */
  description: string;
  /** 自由输入参数的提示占位，如 '目标描述'。有 hint 时表示需要参数。 */
  hint?: string;
  /** 是否接受图片等附件提交。缺省为 false。 */
  attachments?: boolean;
  /** 是否为前端自处理命令（例如唤起前端模型选择弹层）。 */
  isClient?: boolean;
}

/** 官方已知命令的中文简述字典（对齐 dsh-client-ui-commands 的 zh 词条）。 */
export const COMMAND_I18N: Record<string, string> = {
  compact: '压缩以上对话内容',
  export: '将当前会话内容导出为 ZIP',
  feedback: '发送关于当前会话的反馈',
  goal: '设置或查看长期任务目标',
  permission: '切换权限预设（沙箱模式与审批策略）',
  plan: '进入或退出计划模式',
  model: '切换当前会话或默认模型',
};

/** 纯前端命令扩展：如 /model 用于呼出模型与推理档位面板。 */
export const CLIENT_COMMANDS: SlashCommandItem[] = [
  {
    name: 'model',
    description: COMMAND_I18N.model,
    isClient: true,
  },
];

/** 将上游 CommandDescriptor 规范化并补充中文描述。 */
export function normalizeCommand(descriptor: CommandDescriptor): SlashCommandItem {
  const name = descriptor.name.toLowerCase();
  const localizedDesc = COMMAND_I18N[name] || descriptor.description;
  return {
    name,
    description: localizedDesc,
    hint: descriptor.input?.hint,
    attachments: descriptor.input?.attachments,
    isClient: false,
  };
}

/**
 * 将宿主命令与客户端命令合并并去重（宿主命令优先）。
 */
export function mergeCommands(
  hostDescriptors: CommandDescriptor[],
  clientCommands: SlashCommandItem[] = CLIENT_COMMANDS,
): SlashCommandItem[] {
  const items: SlashCommandItem[] = [];
  const seen = new Set<string>();

  for (const desc of hostDescriptors) {
    const item = normalizeCommand(desc);
    items.push(item);
    seen.add(item.name);
  }

  for (const client of clientCommands) {
    if (!seen.has(client.name)) {
      items.push(client);
      seen.add(client.name);
    }
  }

  return items;
}

/**
 * 判断输入是否满足呼出斜杠菜单的条件，若满足则返回搜索 query。
 * 规则：
 * 1. 必须以 '/' 开头；
 * 2. 如果包含空白字符且光标在空白之后，说明正在输入参数，不呼出菜单；
 * 3. 否则提取 '/' 后的文本作为 query。
 */
export function detectSlashTrigger(
  input: string,
  cursorPos?: number,
): { active: boolean; query: string } {
  if (!input.startsWith('/')) {
    return { active: false, query: '' };
  }

  // 截取到光标位置（若提供）或整段
  const effective = cursorPos !== undefined ? input.slice(0, cursorPos) : input;
  const firstSpaceIdx = effective.search(/\s/);

  // 如果光标在第一个空格之后，说明正在输入参数
  if (firstSpaceIdx !== -1) {
    return { active: false, query: '' };
  }

  const query = effective.slice(1).trim().toLowerCase();
  return { active: true, query };
}

/**
 * 根据 query 对命令列表进行模糊过滤与加权排序。
 */
export function filterSlashCommands(
  commands: SlashCommandItem[],
  query: string,
): SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...commands];
  }

  const exactPrefix: SlashCommandItem[] = [];
  const nameIncludes: SlashCommandItem[] = [];
  const descIncludes: SlashCommandItem[] = [];

  for (const cmd of commands) {
    const name = cmd.name.toLowerCase();
    const desc = cmd.description.toLowerCase();

    if (name.startsWith(q)) {
      exactPrefix.push(cmd);
    } else if (name.includes(q)) {
      nameIncludes.push(cmd);
    } else if (desc.includes(q)) {
      descIncludes.push(cmd);
    }
  }

  exactPrefix.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  nameIncludes.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  descIncludes.sort((a, b) => a.name.localeCompare(b.name));

  return [...exactPrefix, ...nameIncludes, ...descIncludes];
}

/**
 * 解析完整命令行（用于 Enter 提交判定）。
 * 返回解析出的命令名称与附带参数。
 */
export function parseSlashLine(line: string): {
  name: string;
  args: string;
  hasArgs: boolean;
  rawInput: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return null;

  const match = /^\/([a-z0-9_-]+)(?:[\t\n\r ](.*))?$/isu.exec(trimmed);
  if (!match) return null;

  const name = match[1].toLowerCase();
  const rawInput = match[2] ?? '';
  const args = rawInput.trim();

  return {
    name,
    args,
    hasArgs: rawInput.length > 0,
    rawInput,
  };
}
