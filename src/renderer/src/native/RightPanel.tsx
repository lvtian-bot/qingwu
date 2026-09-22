/**
 * 右侧工作区与交付成果面板（Files & Changes Panel）：
 * - 变更审查（Changes Review）：对齐 DSH changes-review 语义与 Codex 变更列表，支持 Diff 与 write 全量预览。
 * - 成果交付（Deliverables）：对齐 DSH deliverables/presented 语义，提供桌面级系统操作（打开、定位、复制）。
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DiffView } from './ToolCard';
export type { TodoEntry } from './TodoPanel';

export interface FileChangeEntry {
  path: string;
  edits: number;
  writes: number;
  /** 最近一次修改的 diff：edit 的前后片段，或 write 的完整内容。 */
  lastEdit?: { oldStr: string; newStr: string };
  addedLines?: number;
  removedLines?: number;
}

export interface DeliverableItem {
  path: string;
  description?: string;
  source: 'presented' | 'write';
  time?: number;
}

export interface RightPanelProps {
  collapsed: boolean;
  /** 面板宽度（拖拽调节），折叠态不消费。 */
  width: number;
  fileChanges: FileChangeEntry[];
  deliverables?: DeliverableItem[];
  workspacePath?: string | null;
  /** 展开/收起面板；按钮在面板顶栏右缘，与会话标题栏的收起态按钮共用图标。 */
  onToggle: () => void;
}

/** 面板开关图标：圆角矩形 + 左侧竖线（对齐官方右侧面板按钮）。 */
export function PanelIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

interface FileMetaInfo {
  name: string;
  ext: string;
  type: 'doc' | 'sheet' | 'slide' | 'pdf' | 'text' | 'code' | 'zip' | 'file';
  label: string;
}

function getFileInfo(filePath: string): FileMetaInfo {
  const name = basename(filePath);
  const match = name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = match ? match[1].toLowerCase() : '';

  if (ext === 'docx' || ext === 'doc') {
    return { name, ext: ext.toUpperCase(), type: 'doc', label: 'DOC' };
  }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'tsv') {
    return { name, ext: ext.toUpperCase(), type: 'sheet', label: ext === 'csv' ? 'CSV' : 'XLS' };
  }
  if (ext === 'pptx' || ext === 'ppt') {
    return { name, ext: ext.toUpperCase(), type: 'slide', label: 'PPT' };
  }
  if (ext === 'pdf') {
    return { name, ext: 'PDF', type: 'pdf', label: 'PDF' };
  }
  if (ext === 'md' || ext === 'markdown') {
    return { name, ext: 'MD', type: 'text', label: 'MD' };
  }
  if (ext === 'txt' || ext === 'log') {
    return { name, ext: 'TXT', type: 'text', label: 'TXT' };
  }
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'html', 'css', 'ps1', 'sh', 'sql', 'yaml', 'yml'].includes(ext)) {
    return { name, ext: ext.toUpperCase(), type: 'code', label: ext.toUpperCase() };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { name, ext: ext.toUpperCase(), type: 'zip', label: 'ZIP' };
  }
  return { name, ext: ext.toUpperCase() || 'FILE', type: 'file', label: ext.toUpperCase() || 'FILE' };
}

export function RightPanel({
  collapsed,
  width,
  fileChanges,
  deliverables = [],
  workspacePath,
  onToggle,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'changes' | 'deliverables'>('changes');
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const handleCopyPath = async (pathStr: string) => {
    try {
      await navigator.clipboard.writeText(pathStr);
      setCopiedPath(pathStr);
      window.setTimeout(() => setCopiedPath(null), 1500);
    } catch {
      // 忽略剪贴板不可用
    }
  };

  const handleOpenPath = (targetPath: string) => {
    void window.qingwu?.openPath?.(targetPath);
  };

  const handleShowInFolder = (targetPath: string) => {
    void window.qingwu?.showItemInFolder?.(targetPath);
  };

  const handleOpenTerminal = () => {
    void window.qingwu?.openTerminal?.(workspacePath ?? undefined);
  };

  const handleOpenWorkspace = () => {
    void window.qingwu?.openPath?.(workspacePath ?? '');
  };

  // 排序交付物：优先展示显式交付（presented），随后是新建全量写入
  const sortedDeliverables = useMemo(() => {
    return [...deliverables].sort((a, b) => {
      if (a.source === 'presented' && b.source !== 'presented') return -1;
      if (b.source === 'presented' && a.source !== 'presented') return 1;
      return (b.time ?? 0) - (a.time ?? 0);
    });
  }, [deliverables]);

  if (collapsed) return null;

  return (
    <aside className="native-panel" style={{ width }} aria-label="工作区与交付成果面板">
      {/* 紧凑 Header (36px, 对齐 Codex) */}
      <div className="native-panel-header">
        <div className="native-panel-tabs">
          <button
            type="button"
            className={`native-panel-tab ${activeTab === 'changes' ? 'active' : ''}`}
            onClick={() => setActiveTab('changes')}
          >
            <span>变更</span>
            {fileChanges.length > 0 && (
              <span className="native-panel-tab-badge">{fileChanges.length}</span>
            )}
          </button>
          <button
            type="button"
            className={`native-panel-tab ${activeTab === 'deliverables' ? 'active' : ''}`}
            onClick={() => setActiveTab('deliverables')}
          >
            <span>交付成果</span>
            {sortedDeliverables.length > 0 && (
              <span className="native-panel-tab-badge">{sortedDeliverables.length}</span>
            )}
          </button>
        </div>

        <div className="native-panel-actions">
          <button
            type="button"
            className="native-icon-btn"
            onClick={handleOpenWorkspace}
            title="在资源管理器中打开工作区"
            aria-label="在资源管理器中打开工作区"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 3.5a1 1 0 0 1 1-1h3.5l1.5 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z" />
            </svg>
          </button>
          <button
            type="button"
            className="native-icon-btn"
            onClick={handleOpenTerminal}
            title="在终端中打开工作区"
            aria-label="在终端中打开工作区"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
              <path d="M5 6.5l2 1.5-2 1.5M9 9.5h2" />
            </svg>
          </button>
          <button
            type="button"
            className="native-icon-btn"
            onClick={onToggle}
            title="收起面板"
            aria-label="收起面板"
          >
            <PanelIcon />
          </button>
        </div>
      </div>

      <div className="native-panel-body">
        {activeTab === 'changes' ? (
          /* ---------- 视图 A: Changes 变更审查 ---------- */
          <div className="native-panel-changes">
            {fileChanges.length > 0 ? (
              <div className="native-panel-files">
                {fileChanges.map((change) => {
                  const info = getFileInfo(change.path);
                  const isExpanded = expandedPath === change.path;
                  const isNewWrite = change.writes > 0 && change.edits === 0;

                  return (
                    <div key={change.path} className={`native-panel-file ${isExpanded ? 'expanded' : ''}`}>
                      <button
                        type="button"
                        className="native-panel-file-row"
                        onClick={() =>
                          setExpandedPath((prev) => (prev === change.path ? null : change.path))
                        }
                        title={change.path}
                      >
                        <svg
                          viewBox="0 0 16 16"
                          width="12"
                          height="12"
                          fill="currentColor"
                          className={`native-panel-chevron ${isExpanded ? 'open' : ''}`}
                          aria-hidden="true"
                        >
                          <path d="M6.2 3.2a.75.75 0 0 0 0 1.1L9.4 8l-3.2 3.7a.75.75 0 1 0 1.1 1.1l3.75-4.25a.75.75 0 0 0 0-1.1L7.3 3.2a.75.75 0 0 0-1.1 0z" />
                        </svg>

                        <span className={`native-file-badge native-file-badge-xs ${info.type}`}>
                          {info.label}
                        </span>

                        <span className="native-panel-file-name">{info.name}</span>

                        <span className="native-panel-file-meta">
                          {isNewWrite ? (
                            <span className="native-meta-new">
                              写入 {change.addedLines ? `${change.addedLines} 行` : ''}
                            </span>
                          ) : (
                            <span className="native-meta-lines">
                              {typeof change.addedLines === 'number' && change.addedLines > 0 && (
                                <span className="native-diff-add-num">+{change.addedLines}</span>
                              )}
                              {typeof change.removedLines === 'number' && change.removedLines > 0 && (
                                <span className="native-diff-del-num">-{change.removedLines}</span>
                              )}
                              {!change.addedLines && !change.removedLines && change.edits + change.writes > 1 && (
                                <span>{change.edits + change.writes} 次</span>
                              )}
                            </span>
                          )}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="native-panel-file-detail">
                          <div className="native-panel-detail-bar">
                            <span className="native-tool-filepath" title={change.path}>
                              {change.path}
                            </span>
                            <div className="native-panel-detail-actions">
                              <button
                                type="button"
                                className="native-btn-ghost-xs"
                                onClick={() => void handleOpenPath(change.path)}
                                title="用系统默认程序打开"
                              >
                                打开
                              </button>
                              <button
                                type="button"
                                className="native-btn-ghost-xs"
                                onClick={() => void handleShowInFolder(change.path)}
                                title="在资源管理器中定位"
                              >
                                定位
                              </button>
                              <button
                                type="button"
                                className="native-btn-ghost-xs"
                                onClick={() => void handleCopyPath(change.path)}
                                title="复制路径"
                              >
                                {copiedPath === change.path ? '已复制' : '复制'}
                              </button>
                            </div>
                          </div>

                          {isNewWrite && change.lastEdit?.newStr ? (
                            <div className="native-file-write-preview">
                              <div className="native-write-banner">
                                <span>新建文件 · 写入 {change.addedLines ?? change.lastEdit.newStr.split('\n').length} 行</span>
                              </div>
                              <pre className="native-write-code">
                                <code>{change.lastEdit.newStr}</code>
                              </pre>
                            </div>
                          ) : change.lastEdit ? (
                            <DiffView oldStr={change.lastEdit.oldStr} newStr={change.lastEdit.newStr} />
                          ) : (
                            <div className="native-panel-empty">已修改，无差异记录</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="native-panel-empty">本会话暂无文件变更</div>
            )}
          </div>
        ) : (
          /* ---------- 视图 B: Deliverables 成果交付 ---------- */
          <div className="native-panel-deliverables">
            {sortedDeliverables.length > 0 ? (
              <div className="native-deliverables-list">
                {sortedDeliverables.map((item) => {
                  const info = getFileInfo(item.path);
                  const isCopied = copiedPath === item.path;

                  return (
                    <div key={item.path} className="native-deliverable-card">
                      <div className="native-deliverable-header">
                        <span className={`native-file-badge ${info.type}`}>
                          {info.label}
                        </span>
                        <div className="native-deliverable-title-box">
                          <span className="native-deliverable-title" title={info.name}>
                            {info.name}
                          </span>
                          {item.description && (
                            <span className="native-deliverable-desc" title={item.description}>
                              {item.description}
                            </span>
                          )}
                          <span className="native-deliverable-sub" title={item.path}>
                            {item.path}
                          </span>
                        </div>
                      </div>

                      <div className="native-deliverable-actions">
                        <button
                          type="button"
                          className="native-btn-ghost-sm"
                          onClick={() => handleOpenPath(item.path)}
                          title="使用系统默认程序打开该文件"
                        >
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
                            <path d="M9 2h5v5M6.5 9.5L14 2" />
                          </svg>
                          <span>打开</span>
                        </button>
                        <button
                          type="button"
                          className="native-btn-ghost-sm"
                          onClick={() => handleShowInFolder(item.path)}
                          title="在 Windows 资源管理器中定位并高亮此文件"
                        >
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1.5 3.5a1 1 0 0 1 1-1h3.5l1.5 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z" />
                          </svg>
                          <span>定位</span>
                        </button>
                        <button
                          type="button"
                          className={`native-btn-ghost-sm ${isCopied ? 'copied' : ''}`}
                          onClick={() => void handleCopyPath(item.path)}
                          title="复制文件路径"
                        >
                          {isCopied ? (
                            <>
                              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M13.5 4.5l-7 7-3.5-3.5" />
                              </svg>
                              <span>已复制</span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                                <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" />
                              </svg>
                              <span>复制</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="native-panel-empty">本会话暂未生成交付成果</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
