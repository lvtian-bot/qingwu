import React, { useEffect, useRef } from 'react';
import type { SlashCommandItem } from './slash-commands';

interface SlashMenuProps {
  items: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (item: SlashCommandItem) => void;
  onHoverIndex: (index: number) => void;
  placement?: 'top' | 'bottom';
}

const SECTION_TITLES: Record<string, string> = {
  add: '常用',
  commands: '指令',
  skills: '技能',
};

/** 绘制命令专属轻量线性 SVG 图标（对齐 Codex / 原生设计风格）。 */
function renderCommandIcon(cmd: SlashCommandItem): React.ReactNode {
  if (cmd.isSkill) {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m11.5 2.5 2 2-8 8-2.5.5.5-2.5 8-8z" />
        <path d="M9.5 4.5l2 2" />
        <path d="M2.5 2v2m-1-1h2m9 8v2m-1-1h2" />
      </svg>
    );
  }

  const name = cmd.name.toLowerCase();

  if (name.includes('mcp')) {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12.5 7.5l-5.5 5.5a3.5 3.5 0 0 1-5-5l6-6a2.5 2.5 0 0 1 3.5 3.5l-5.5 5.5a1 1 0 0 1-1.5-1.5l5-5" />
      </svg>
    );
  }

  if (name.includes('status') || name.includes('usage') || name.includes('计费')) {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3.5l2.5 1.5" />
      </svg>
    );
  }

  if (name.includes('init') || name.includes('初始化')) {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 2.5h5.5L12.5 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z" />
        <path d="M9.5 2.5v3h3" />
        <path d="M5.5 8h5M5.5 10.5h3.5" />
      </svg>
    );
  }

  if (name.includes('fast') || name.includes('快速')) {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8.5 1.5 3.5 9h4l-1 5.5 6-7.5h-4z" />
      </svg>
    );
  }

  if (name.includes('project') || name.includes('项目')) {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 4a1 1 0 0 1 1-1h3.5l1.5 2h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4z" />
      </svg>
    );
  }

  if (name.includes('draw') || name.includes('绘图')) {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 13c2-1 4-1 6-3s3-4 4-7c-3 1-5 2-7 4s-2 4-3 6z" />
      </svg>
    );
  }

  switch (name) {
    case 'goal':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 2v2m0 8v2m-6-6h2m8 0h2" />
        </svg>
      );
    case 'plan':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
          <path d="M6 5.5h4M6 8h4M6 10.5h2.5" />
        </svg>
      );
    case 'feedback':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6.5l-3 2.5v-2.5h-0.5a1 1 0 0 1-1-1v-6z" />
          <path d="M5.5 5.5h5M5.5 8h3" />
        </svg>
      );
    case 'compact':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 3.5l4 3.5 4-3.5M4 12.5l4-3.5 4 3.5" />
        </svg>
      );
    case 'permission':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2s4.5 1 5 4.5c0 4-3 6.5-5 7.5-2-1-5-3.5-5-7.5C3.5 3 8 2 8 2z" />
        </svg>
      );
    case 'model':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 1.5c.2 1.8 1.2 2.8 3 3-1.8.2-2.8 1.2-3 3-.2-1.8-1.2-2.8-3-3 1.8-.2 2.8-1.2 3-3z" />
          <path d="M12 9.5c.1.9.6 1.4 1.5 1.5-.9.1-1.4.6-1.5 1.5-.1-.9-.6-1.4-1.5-1.5.9-.1 1.4-.6 1.5-1.5z" />
          <path d="M3.5 10c.1.9.6 1.4 1.5 1.5-.9.1-1.4.6-1.5 1.5-.1-.9-.6-1.4-1.5-1.5.9-.1 1.4-.6 1.5-1.5z" />
        </svg>
      );
    case 'export':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 11.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
          <path d="m5 7.5 3 3 3-3" />
          <path d="M8 2.5v8" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 11 6-6" />
          <path d="M4 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
        </svg>
      );
  }
}

export function SlashMenu({
  items,
  selectedIndex,
  onSelect,
  onHoverIndex,
  placement = 'top',
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
      <div className={`native-slash-menu placement-${placement}`}>
        <div className="native-slash-empty">无匹配的斜杠命令或技能</div>
      </div>
    );
  }

  // 统计是否跨分组，若存在多个分组则在切换分组时展示分组头（顶部第一组不重复展示头）
  const distinctSections = new Set(items.map((item) => item.section));
  const showSections = distinctSections.size > 1 || distinctSections.has('skills');

  return (
    <div
      className={`native-slash-menu placement-${placement}`}
      role="listbox"
      aria-label="斜杠命令与技能列表"
    >
      <div className="native-slash-list" ref={listRef}>
        {items.map((cmd, idx) => {
          const isActive = idx === selectedIndex;
          const prevCmd = items[idx - 1];
          const isNewSection = showSections && idx > 0 && prevCmd && prevCmd.section !== cmd.section;

          return (
            <React.Fragment key={cmd.name}>
              {isNewSection && (
                <div className="native-slash-section-header">
                  {SECTION_TITLES[cmd.section] || cmd.section}
                </div>
              )}
              <div
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
                <span className="native-slash-icon">{renderCommandIcon(cmd)}</span>
                <span className="native-slash-label">{cmd.label}</span>
                {cmd.description && (
                  <span className="native-slash-desc" title={cmd.description}>
                    {cmd.description}
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
