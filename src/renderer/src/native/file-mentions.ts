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
