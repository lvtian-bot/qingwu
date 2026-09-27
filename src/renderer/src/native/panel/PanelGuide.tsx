/**
 * 右侧面板的「开始页」：面板展开且该格没有打开任何页时的落点。
 * 各入口以卡片呈现（图标 + 标题 + 一行描述 + 右对齐快捷键），点击即让位给对应页。
 */
import { useT } from "../../i18n";
import { GuideFolderArtwork, GuideTerminalArtwork } from "./glyphs";

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
  const t = useT();
  return (
    <div className="panel-guide">
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
            <span className="panel-guide-entry-title">{t("panel.guide.files.title")}</span>
            <span className="panel-guide-entry-desc">{t("panel.guide.files.desc")}</span>
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
            <span className="panel-guide-entry-title">{t("panel.guide.terminal.title")}</span>
            <span className="panel-guide-entry-desc">{t("panel.guide.terminal.desc")}</span>
          </span>
          {showShortcuts && (
            <span className="panel-guide-entry-key">Ctrl + `</span>
          )}
        </button>
      </div>
    </div>
  );
}
