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
      <div className="native-file-mention-header">文件与文件夹</div>
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
                  {isDir ? (
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1.5 3.5a1 1 0 0 1 1-1h3.5l1.5 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3.5 1.5h6l3.5 3.5v9a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" />
                      <path d="M9.5 1.5v3.5h3.5" />
                    </svg>
                  )}
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
                    title="按 Tab 或点击进入下一层"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item, 'drill');
                    }}
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 3 5 5-5 5" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
