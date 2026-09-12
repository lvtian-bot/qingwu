/**
 * 语义化工具调用卡片：按 wire 工具名映射到专用视图（终端/文件/搜索/编辑 diff/
 * 任务清单），未知工具回退通用 JSON 视图。数据结构依据本机真实会话日志实测。
 */
import { useMemo, useState } from 'react';
import { diffLines } from 'diff';
import type {
  EditArgs,
  PatternArgs,
  PwshArgs,
  ReadArgs,
  TodoWriteArgs,
  WriteArgs,
} from './protocol';

/** 工具调用条目：call 事件与 result 事件按 callId 配对。 */
export interface ToolItem {
  callId: string;
  name: string;
  arguments: string;
  resultText?: string;
  isError?: boolean;
  pending: boolean;
  callTime?: number;
  resultTime?: number;
}

// ---------- 通用工具 ----------

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** 相对 cwd 显示路径，跨盘符等无法相对化时回退原路径。 */
function relPath(p: string, cwd?: string): string {
  if (!cwd) return p;
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const np = norm(p);
  const nc = norm(cwd);
  if (nc && np.toLowerCase().startsWith(nc.toLowerCase() + '/')) {
    return np.slice(nc.length + 1);
  }
  return p;
}

/** pwsh 结果尾部 “[exit code: N]” → N；无则 null。 */
export function parseExitCode(resultText?: string): number | null {
  if (!resultText) return null;
  const m = /\[exit code:\s*(-?\d+)\]\s*$/.exec(resultText.trim());
  return m ? Number(m[1]) : null;
}

function formatDuration(ms?: number): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

// ---------- 图标（内联 SVG，14x14） ----------

function Icon({ path }: { path: string }) {
  return (
    <svg className="native-tool-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  terminal: 'M4 17l6-6-6-6M12 19h8',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  edit: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z',
  list: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  write: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z',
  tool: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
} as const;

// ---------- Diff 视图 ----------

/** old→new 行级 diff：红/绿背景 + -/+ 前缀。 */
export function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  /** 超出上限的行不再渲染，避免大 diff 拖垮面板与会话流。 */
  const MAX_DIFF_LINES = 400;
  const lines = useMemo(() => {
    const parts = diffLines(oldStr, newStr) as { added?: boolean; removed?: boolean; value: string }[];
    const rows: { sign: '+' | '-' | ' '; text: string }[] = [];
    for (const part of parts) {
      const sign: '+' | '-' | ' ' = part.added ? '+' : part.removed ? '-' : ' ';
      for (const line of part.value.replace(/\n$/, '').split('\n')) {
        rows.push({ sign, text: line });
      }
    }
    return rows;
  }, [oldStr, newStr]);
  const shown = lines.length > MAX_DIFF_LINES ? lines.slice(0, MAX_DIFF_LINES) : lines;

  return (
    <div className="native-diff">
      {shown.map((line, i) => (
        <div key={i} className={`native-diff-line ${line.sign === '+' ? 'add' : line.sign === '-' ? 'del' : ''}`}>
          <span className="native-diff-sign">{line.sign}</span>
          <span className="native-diff-text">{line.text || ' '}</span>
        </div>
      ))}
      {lines.length > MAX_DIFF_LINES && (
        <div className="native-diff-more">… 其余 {lines.length - MAX_DIFF_LINES} 行未显示</div>
      )}
    </div>
  );
}

// ---------- 卡片外壳 ----------

interface CardShellProps {
  icon: string;
  title: string;
  subtitle?: string;
  status: React.ReactNode;
  detail?: React.ReactNode;
  error?: boolean;
}

function CardShell({ icon, title, subtitle, status, detail, error }: CardShellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`native-tool-card${error ? ' error' : ''}`}>
      <button className="native-tool-head" onClick={() => setOpen((v) => !v)}>
        <Icon path={icon} />
        <span className="native-tool-title">{title}</span>
        {subtitle && <span className="native-tool-sub">{subtitle}</span>}
        <span className="native-tool-status">{status}</span>
        <span className={`native-tool-chevron${open ? ' open' : ''}`}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && detail && <div className="native-tool-detail">{detail}</div>}
    </div>
  );
}

/** 状态区：执行中 spinner / 失败 / 时长 + exit code。 */
function StatusView({ tool }: { tool: ToolItem }) {
  if (tool.pending) {
    return (
      <span className="native-tool-pending">
        <span className="native-spinner" />
        运行中
      </span>
    );
  }
  const duration = formatDuration((tool.resultTime ?? 0) - (tool.callTime ?? 0));
  const exitCode = parseExitCode(tool.resultText);
  if (tool.isError || (exitCode !== null && exitCode !== 0)) {
    return (
      <span className="native-tool-fail">
        失败{exitCode !== null ? ` · exit ${exitCode}` : ''}
        {duration ? ` · ${duration}` : ''}
      </span>
    );
  }
  return (
    <span className="native-tool-ok">
      {exitCode !== null ? `exit ${exitCode}` : '完成'}
      {duration ? ` · ${duration}` : ''}
    </span>
  );
}

// ---------- 结果输出块 ----------

function OutputView({ text }: { text?: string }) {
  if (!text) return null;
  return <pre className="native-tool-output">{text}</pre>;
}

// ---------- 各工具视图 ----------

function parseArgs<T>(tool: ToolItem): T | null {
  try {
    return JSON.parse(tool.arguments || '{}') as T;
  } catch {
    return null;
  }
}

function PwshCard({ tool }: { tool: ToolItem }) {
  const args = parseArgs<PwshArgs>(tool);
  const title = args?.description?.trim() || '执行命令';
  return (
    <CardShell
      icon={ICONS.terminal}
      title={title}
      status={<StatusView tool={tool} />}
      error={tool.isError || (parseExitCode(tool.resultText) ?? 0) !== 0}
      detail={
        <>
          <pre className="native-tool-command">{args?.command ?? ''}</pre>
          <OutputView text={tool.resultText} />
        </>
      }
    />
  );
}

function ReadCard({ tool, cwd }: { tool: ToolItem; cwd?: string }) {
  const args = parseArgs<ReadArgs>(tool);
  const filePath = args?.file_path ?? '';
  const range = args?.offset !== undefined || args?.limit !== undefined
    ? `（${args?.offset !== undefined ? `从第 ${args.offset} 行` : ''}${args?.limit !== undefined ? `${args?.offset !== undefined ? '起' : ''}取 ${args.limit} 行` : ''}）`
    : '';
  return (
    <CardShell
      icon={ICONS.file}
      title={basename(filePath) || '读取文件'}
      subtitle={`${relPath(filePath, cwd)}${range}`}
      status={<StatusView tool={tool} />}
      error={tool.isError}
      detail={<OutputView text={tool.resultText} />}
    />
  );
}

function SearchCard({ tool, cwd, kind }: { tool: ToolItem; cwd?: string; kind: 'grep' | 'glob' }) {
  const args = parseArgs<PatternArgs>(tool);
  const verb = kind === 'grep' ? '搜索' : '匹配';
  const title = args?.pattern ? `${verb} "${args.pattern}"` : verb;
  return (
    <CardShell
      icon={ICONS.search}
      title={title}
      subtitle={args?.path ? relPath(args.path, cwd) : ''}
      status={<StatusView tool={tool} />}
      error={tool.isError}
      detail={<OutputView text={tool.resultText} />}
    />
  );
}

function EditCard({ tool, cwd }: { tool: ToolItem; cwd?: string }) {
  const args = parseArgs<EditArgs>(tool);
  const filePath = args?.file_path ?? '';
  return (
    <CardShell
      icon={ICONS.edit}
      title={basename(filePath) || '编辑文件'}
      subtitle={`编辑 · ${relPath(filePath, cwd)}`}
      status={<StatusView tool={tool} />}
      error={tool.isError}
      detail={
        args ? (
          <>
            <div className="native-tool-filepath">{relPath(filePath, cwd)}</div>
            <DiffView oldStr={args.old_string ?? ''} newStr={args.new_string ?? ''} />
          </>
        ) : (
          <OutputView text={tool.resultText} />
        )
      }
    />
  );
}

function WriteCard({ tool, cwd }: { tool: ToolItem; cwd?: string }) {
  const args = parseArgs<WriteArgs>(tool);
  const filePath = args?.file_path ?? '';
  return (
    <CardShell
      icon={ICONS.write}
      title={basename(filePath) || '写入文件'}
      subtitle={`写入 · ${relPath(filePath, cwd)}`}
      status={<StatusView tool={tool} />}
      error={tool.isError}
      detail={
        <>
          <div className="native-tool-filepath">{relPath(filePath, cwd)}</div>
          {args?.content && <pre className="native-tool-output">{args.content}</pre>}
          <OutputView text={tool.resultText} />
        </>
      }
    />
  );
}

function TodoCard({ tool }: { tool: ToolItem }) {
  const args = parseArgs<TodoWriteArgs>(tool);
  const todos = args?.todos ?? [];
  const doing = todos.filter((t) => t.status === 'in_progress').length;
  const done = todos.filter((t) => t.status === 'done').length;
  return (
    <CardShell
      icon={ICONS.list}
      title="更新任务清单"
      subtitle={`${todos.length} 项 · ${done} 完成 · ${doing} 进行中`}
      status={<StatusView tool={tool} />}
      error={tool.isError}
      detail={
        <ul className="native-tool-todos">
          {todos.map((todo, i) => (
            <li key={i} className={`native-todo-${todo.status}`}>
              <span className="native-todo-mark">
                {todo.status === 'done' ? '✓' : todo.status === 'in_progress' ? '◐' : '○'}
              </span>
              <span className="native-todo-text">{todo.content}</span>
            </li>
          ))}
        </ul>
      }
    />
  );
}

function GenericCard({ tool }: { tool: ToolItem }) {
  const pretty = useMemo(() => {
    try {
      return tool.arguments ? JSON.stringify(JSON.parse(tool.arguments), null, 2) : '';
    } catch {
      return tool.arguments;
    }
  }, [tool.arguments]);
  return (
    <CardShell
      icon={ICONS.tool}
      title={tool.name}
      status={<StatusView tool={tool} />}
      error={tool.isError}
      detail={
        <>
          {pretty && <pre className="native-tool-command">{pretty}</pre>}
          <OutputView text={tool.resultText} />
        </>
      }
    />
  );
}

/** 工具卡片入口：按工具名分派，未知回退通用视图。 */
export function ToolCard({ tool, cwd }: { tool: ToolItem; cwd?: string }) {
  switch (tool.name) {
    case 'pwsh':
    case 'bash':
    case 'shell':
      return <PwshCard tool={tool} />;
    case 'read':
      return <ReadCard tool={tool} cwd={cwd} />;
    case 'grep':
      return <SearchCard tool={tool} cwd={cwd} kind="grep" />;
    case 'glob':
      return <SearchCard tool={tool} cwd={cwd} kind="glob" />;
    case 'edit':
      return <EditCard tool={tool} cwd={cwd} />;
    case 'write':
      return <WriteCard tool={tool} cwd={cwd} />;
    case 'todo_write':
      return <TodoCard tool={tool} />;
    default:
      return <GenericCard tool={tool} />;
  }
}
