/**
 * 文件与目录引用（@ 菜单）数据契约与语法解析。
 * 对齐官方 @deepseek-ai/dsh-file-reference 与 dsh-client-ui-reference 规范。
 */

export interface FileReferenceCandidate {
  path: string;
  kind: 'file' | 'directory';
}

export interface AtTriggerResult {
  active: boolean;
  query: string;
  quoted: boolean;
  span: { start: number; end: number };
}

/**
 * 提取光标处的 @path 或 @"path with spaces 触发。
 * 规避诸如电子邮件地址等单词内部的 @（需位于开头或空白后）。
 */
export function detectAtTrigger(input: string, cursorPos?: number): AtTriggerResult {
  const closed: AtTriggerResult = {
    active: false,
    query: '',
    quoted: false,
    span: { start: 0, end: 0 },
  };

  if (!input) return closed;

  const caret =
    cursorPos !== undefined && cursorPos >= 0 && cursorPos <= input.length
      ? cursorPos
      : input.length;

  const beforeCursor = input.slice(0, caret);

  // 1. 匹配 @"...
  const quotedMatch = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor);
  if (quotedMatch?.[1] !== undefined && quotedMatch[2] !== undefined) {
    const start = caret - quotedMatch[1].length;
    return {
      active: true,
      query: quotedMatch[2],
      quoted: true,
      span: { start, end: caret },
    };
  }

  // 2. 匹配 @...
  const plainMatch = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor);
  if (plainMatch?.[1] !== undefined && plainMatch[2] !== undefined) {
    const start = caret - plainMatch[1].length;
    return {
      active: true,
      query: plainMatch[2],
      quoted: false,
      span: { start, end: caret },
    };
  }

  return closed;
}

/**
 * 将绝对路径或相对路径转换为相对于 cwd 的标准展示路径（POSIX 风格分隔符）。
 * 跨盘符或无法相对化时回退原路径；同盘符或子路径则转为相对路径。
 */
export function relativizePathToCwd(rawPath: string, cwd?: string | null): string {
  if (!rawPath) return '';
  const trimmed = rawPath.trim();
  if (!cwd) return trimmed.replace(/\\/g, '/');

  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const np = norm(trimmed);
  const nc = norm(cwd);

  if (nc && np.toLowerCase() === nc.toLowerCase()) {
    return '.';
  }
  if (nc && np.toLowerCase().startsWith(nc.toLowerCase() + '/')) {
    return np.slice(nc.length + 1);
  }
  return np;
}

/**
 * 将选中的文件或目录格式化为 Prompt 文本规范。
 * 对齐官方 formatFileMention 逻辑：
 * 包含空格或显式要求引号时使用 @"path"；目录后追加 /；
 * 若目录包含引号或显式保留引号，其末尾引号保持开放以便下钻继续输入。
 */
export function formatFileMention(
  candidate: FileReferenceCandidate,
  preserveQuote = false,
): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path;
  // 检查是否包含控制字符或非法字符
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined;

  const needsQuote = preserveQuote || /\s/u.test(path);
  if (!needsQuote) {
    return `@${path}`;
  }

  if (candidate.kind === 'directory') {
    return `@"${path}`;
  }
  return `@"${path}"`;
}

/**
 * 将相对或绝对路径转换为适合发送的 @ 文件引用字符串。
 * 若指定了 cwd，优先转换为相对于 cwd 的相对路径。
 */
export function formatFileMentionFromPath(
  rawPath: string,
  cwd?: string | null,
  isDirectory = false,
): string | undefined {
  if (!rawPath) return undefined;
  const rel = relativizePathToCwd(rawPath, cwd);
  if (!rel) return undefined;
  return formatFileMention({
    path: rel,
    kind: isDirectory ? 'directory' : 'file',
  });
}

export interface UserTextSegment {
  kind: 'text' | 'file' | 'directory';
  raw: string;
  path?: string;
  display?: string;
}

/**
 * 将用户消息中的文本解析为投射分段。
 * 匹配 @"path with spaces" 与 @path，对齐官方 projectUserText 行为。
 */
export function parseUserTextMentions(text: string): UserTextSegment[] {
  if (!text) return [];

  const segments: UserTextSegment[] = [];
  // 匹配 @"..." 或 @token（允许位于开头或任意字符后，但以 @ 或 @" 开头）
  const mentionRe = /(?:^|\s)(@"([^"\n]+)"|@([^\s，。！？、；：“”‘’（）()]+))/gu;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRe.exec(text)) !== null) {
    const fullMatch = match[0];
    const token = match[1]; // @"..." 或 @...
    const quotedInner = match[2]; // 引号内部路径
    const plainInner = match[3]; // 无引号路径

    const tokenStart = match.index + (fullMatch.length - token.length);

    if (tokenStart > lastIndex) {
      segments.push({
        kind: 'text',
        raw: text.slice(lastIndex, tokenStart),
      });
    }

    let rawPath = quotedInner !== undefined ? quotedInner : plainInner;
    // 规避纯邮箱地址（例如 test@example.com）
    if (tokenStart > 0 && text[tokenStart - 1] !== ' ' && text[tokenStart - 1] !== '\n') {
      segments.push({
        kind: 'text',
        raw: token,
      });
      lastIndex = tokenStart + token.length;
      continue;
    }

    const isDir = rawPath.endsWith('/') || rawPath.endsWith('\\');
    const cleanPath = isDir ? rawPath.slice(0, -1) : rawPath;
    const baseName = cleanPath.split(/[\\/]/).filter(Boolean).pop() ?? cleanPath;
    const display = isDir ? `${baseName}/` : baseName;

    segments.push({
      kind: isDir ? 'directory' : 'file',
      raw: token,
      path: rawPath,
      display,
    });

    lastIndex = tokenStart + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({
      kind: 'text',
      raw: text.slice(lastIndex),
    });
  }

  return segments;
}
