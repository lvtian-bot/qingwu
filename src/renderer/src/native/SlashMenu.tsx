import { useEffect, useRef } from 'react';
import type { SlashCommandItem } from './slash-commands';

interface SlashMenuProps {
  items: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (item: SlashCommandItem) => void;
  onHoverIndex: (index: number) => void;
}

export function SlashMenu({
  items,
  selectedIndex,
  onSelect,
  onHoverIndex,
}: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // 保证选中项随键盘方向键滚动保持在可见视区
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('.native-slash-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <div className="native-slash-menu">
        <div className="native-slash-empty">无匹配的斜杠命令</div>
      </div>
    );
  }

  return (
    <div className="native-slash-menu" role="listbox" aria-label="斜杠命令列表">
      <div className="native-slash-list" ref={listRef}>
        {items.map((cmd, idx) => {
          const isActive = idx === selectedIndex;
          return (
            <div
              key={cmd.name}
              role="option"
              aria-selected={isActive}
              className={`native-slash-item ${isActive ? 'active' : ''}`}
              onMouseEnter={() => onHoverIndex(idx)}
              onMouseDown={(e) => {
                // 阻止默认行为以防止 textarea 失去焦点
                e.preventDefault();
                onSelect(cmd);
              }}
            >
              <div className="native-slash-item-left">
                <span className="native-slash-name">/{cmd.name}</span>
                {cmd.hint && (
                  <span className="native-slash-hint">&lt;{cmd.hint}&gt;</span>
                )}
              </div>
              <div className="native-slash-desc" title={cmd.description}>
                {cmd.description}
              </div>
            </div>
          );
        })}
      </div>
      <div className="native-slash-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>Enter</kbd> / <kbd>Tab</kbd> 采纳</span>
        <span><kbd>Esc</kbd> 取消</span>
      </div>
    </div>
  );
}
