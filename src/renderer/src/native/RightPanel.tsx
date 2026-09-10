/**
 * 右侧面板：任务进度（todo_write 最新状态）+ 文件变更（edit/write 聚合）。
 * 数据由 NativeApp 从会话事件派生，无独立 IPC。
 */
import { useState } from 'react';
import { DiffView } from './ToolCard';

export interface TodoEntry {
  content: string;
  status: string;
}

export interface FileChangeEntry {
  path: string;
  edits: number;
  writes: number;
  /** 最近一次 edit 的前后内容，用于展开 diff。 */
  lastEdit?: { oldStr: string; newStr: string };
}

export interface RightPanelProps {
  collapsed: boolean;
  /** 面板宽度（拖拽调节），折叠态不消费。 */
  width: number;
  todos: TodoEntry[] | null;
  fileChanges: FileChangeEntry[];
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

export function RightPanel({ collapsed, width, todos, fileChanges }: RightPanelProps) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  if (collapsed) return null;

  return (
    <aside className="native-panel" style={{ width }}>
      <div className="native-panel-header">
        <span className="native-panel-title">工作区</span>
      </div>

      <div className="native-panel-body">
        <section className="native-panel-section">
          <div className="native-panel-section-title">任务进度</div>
          {todos && todos.length > 0 ? (
            <ul className="native-panel-todos">
              {todos.map((todo, i) => (
                <li key={i} className={`native-todo-${todo.status}`}>
                  <span className="native-todo-mark">
                    {todo.status === 'done' ? '✓' : todo.status === 'in_progress' ? '◐' : '○'}
                  </span>
                  <span className="native-todo-text">{todo.content}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="native-panel-empty">本会话暂无任务清单</div>
          )}
        </section>

        <section className="native-panel-section">
          <div className="native-panel-section-title">
            文件变更
            {fileChanges.length > 0 && <span className="native-panel-count">{fileChanges.length}</span>}
          </div>
          {fileChanges.length > 0 ? (
            <div className="native-panel-files">
              {fileChanges.map((change) => (
                <div key={change.path} className="native-panel-file">
                  <button
                    className="native-panel-file-row"
                    onClick={() =>
                      setExpandedPath((prev) => (prev === change.path ? null : change.path))
                    }
                    title={change.path}
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />
                    </svg>
                    <span className="native-panel-file-name">{basename(change.path)}</span>
                    <span className="native-panel-file-meta">
                      {change.edits + change.writes > 1 ? `${change.edits + change.writes} 次` : ''}
                    </span>
                  </button>
                  {expandedPath === change.path && (
                    <div className="native-panel-file-detail">
                      <div className="native-tool-filepath">{change.path}</div>
                      {change.lastEdit ? (
                        <DiffView oldStr={change.lastEdit.oldStr} newStr={change.lastEdit.newStr} />
                      ) : (
                        <div className="native-panel-empty">写入操作，无 diff</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="native-panel-empty">本会话暂无文件修改</div>
          )}
        </section>
      </div>
    </aside>
  );
}
