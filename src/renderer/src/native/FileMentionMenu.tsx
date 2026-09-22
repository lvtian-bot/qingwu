import { useEffect, useRef } from 'react';
import type { FileReferenceCandidate } from './file-mentions';

interface FileMentionMenuProps {
  items: FileReferenceCandidate[];
  selectedIndex: number;
  onSelect: (item: FileReferenceCandidate, action?: 'pick' | 'drill') => void;
  onHoverIndex: (index: number) => void;
  query: string;
  placement?: 'top' | 'bottom';
}

/**
 * 极简中性单色图标（对齐 Codex 近单色设计系统）
 */
function renderItemIcon(isDir: boolean) {
  if (isDir) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1.75 3.5A1.25 1.25 0 0 1 3 2.25h3.2c.33 0 .65.13.88.37l1.3 1.38h4.87A1.25 1.25 0 0 1 14.5 5.25v7A1.25 1.25 0 0 1 13.25 13.5H3A1.25 1.25 0 0 1 1.75 12.25v-8.75Z" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.75 1.75h5.5l3.5 3.5v8.5a1.25 1.25 0 0 1-1.25 1.25h-7.75a1.25 1.25 0 0 1-1.25-1.25v-10.5a1.25 1.25 0 0 1 1.25-1.25Z" />
      <path d="M9.25 1.75v3.5h3.5" />
    </svg>
  );
}

export function FileMentionMenu({
  items,
  selectedIndex,
  onSelect,
  onHoverIndex,
  query,
  placement = 'top',
}: FileMentionMenuProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('.native-file-mention-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <div
        className={`native-file-mention-menu placement-${placement}`}
        role="listbox"
        aria-label="文件与文件夹引用"
      >
        <div className="native-file-mention-empty">
          {query ? `未找到与 "${query}" 匹配的文件` : '工作区内暂无文件'}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`native-file-mention-menu placement-${placement}`}
      role="listbox"
      aria-label="文件与文件夹引用"
    >
      <div className="native-file-mention-header">
        <span>文件与文件夹</span>
        <span className="native-file-mention-header-count">{items.length}</span>
      </div>

      <div className="native-file-mention-list" ref={listRef}>
        {items.map((item, idx) => {
          const isActive = idx === selectedIndex;
          const isDir = item.kind === 'directory';
          const slash = item.path.lastIndexOf('/');
          const name = item.path.slice(slash + 1);
          const parent = slash < 0 ? '' : item.path.slice(0, slash);

          return (
            <div
              key={item.path}
              role="option"
              aria-selected={isActive}
              className={`native-file-mention-item ${isActive ? 'active' : ''}`}
              onMouseEnter={() => onHoverIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item, 'pick');
              }}
            >
              <div className="native-file-mention-item-left">
                <span className="native-file-mention-icon">
                  {renderItemIcon(isDir)}
                </span>
                <span className="native-file-mention-name">
                  {name}{isDir ? '/' : ''}
                </span>
              </div>
              <div className="native-file-mention-item-right">
                {parent && (
                  <span className="native-file-mention-parent" title={parent}>
                    {parent}
                  </span>
                )}
                {isDir && (
                  <button
                    type="button"
                    className="native-file-mention-drill-btn"
                    title="按 Tab 进入该目录"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item, 'drill');
                    }}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m6 3.5 4.5 4.5-4.5 4.5" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="native-file-mention-footer">
        <span className="native-file-mention-footer-hint">
          <kbd className="native-kbd">↑↓</kbd> 移动
        </span>
        <span className="native-file-mention-footer-hint">
          <kbd className="native-kbd">↵</kbd> 引用
        </span>
        <span className="native-file-mention-footer-hint">
          <kbd className="native-kbd">Tab</kbd> 下钻
        </span>
        <span className="native-file-mention-footer-hint">
          <kbd className="native-kbd">Esc</kbd> 关闭
        </span>
      </div>
    </div>
  );
}
