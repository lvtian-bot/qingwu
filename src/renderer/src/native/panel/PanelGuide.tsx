/**
 * 右侧面板的「开始页」：面板展开且该格没有打开任何页时的落点。
 * 各入口以卡片呈现（图标 + 标题 + 一行描述 + 右对齐快捷键），点击即让位给对应页。
 */
import { CompassIcon, GuideFolderArtwork, GuideTerminalArtwork } from "./glyphs";

export interface PanelGuideProps {
  /** 打开（或聚焦）工作区文件页，替换开始页。 */
  onOpenFiles: () => void;
  /** 在系统终端中打开会话工作区。 */
  onOpenTerminal: () => void;
  /** 是否显示各入口的快捷键提示（快捷键绑定可用时才显示）。 */
  showShortcuts?: boolean;
}

export function PanelGuide({
  onOpenFiles,
  onOpenTerminal,
  showShortcuts = true,
}: PanelGuideProps) {
  return (
    <div className="panel-guide">
      <div className="panel-guide-compass">
        <CompassIcon size={44} />
      </div>
      <div className="panel-guide-entries">
        <button
          type="button"
          className="panel-guide-entry"
          onClick={onOpenFiles}
        >
          <span className="panel-guide-entry-icon">
            <GuideFolderArtwork />
          </span>
          <span className="panel-guide-entry-text">
            <span className="panel-guide-entry-title">工作区文件</span>
            <span className="panel-guide-entry-desc">浏览会话工作区的文件</span>
          </span>
          {showShortcuts && (
            <span className="panel-guide-entry-key">Ctrl + P</span>
          )}
        </button>
        <button
          type="button"
          className="panel-guide-entry"
          onClick={onOpenTerminal}
        >
          <span className="panel-guide-entry-icon">
            <GuideTerminalArtwork />
          </span>
          <span className="panel-guide-entry-text">
            <span className="panel-guide-entry-title">新建终端</span>
            <span className="panel-guide-entry-desc">在会话工作区运行命令</span>
          </span>
          {showShortcuts && (
            <span className="panel-guide-entry-key">Ctrl + `</span>
          )}
        </button>
      </div>
    </div>
  );
}
