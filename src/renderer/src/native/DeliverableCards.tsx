/**
 * 轮次收尾的交付卡片（对齐官方 deliverables 卡片语义）：
 * present 声明的文件随回复收尾展示——单个一行、多个双列网格、超过四个折叠。
 * 卡片主体点击在右侧面板打开预览；打开/定位走系统桌面操作。
 */
import { useState } from "react";
import type { TurnDeliverable } from "./events";
import { basename, fileInfoOf, resolveAgainstCwd } from "./panel/workspace-files";
import { FileGlyph } from "./panel/glyphs";

const COLLAPSED_COUNT = 4;

export function DeliverableCards({
  files,
  cwd,
  onOpenFile,
}: {
  files: TurnDeliverable[];
  cwd?: string | null;
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const visible = expanded ? files : files.slice(0, COLLAPSED_COUNT);

  return (
    <div className="native-deliv">
      <div
        className="native-deliv-grid"
        data-multiple={files.length > 1 || undefined}
      >
        {visible.map((file) => (
          <DeliverableCard
            key={file.path}
            file={file}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
      {files.length > COLLAPSED_COUNT && (
        <button
          type="button"
          className="native-deliv-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起交付清单" : `展开全部交付（${files.length} 项）`}
        </button>
      )}
    </div>
  );
}

function DeliverableCard({
  file,
  cwd,
  onOpenFile,
}: {
  file: TurnDeliverable;
  cwd?: string | null;
  onOpenFile?: (path: string) => void;
}) {
  const [feedback, setFeedback] = useState<"open" | "reveal" | null>(null);
  const info = fileInfoOf(file.path);
  const absolute = resolveAgainstCwd(cwd, file.path);

  const runAction = (action: "open" | "reveal") => {
    setFeedback(action);
    window.setTimeout(() => setFeedback(null), 1500);
    if (action === "open") void window.qingwu?.openPath?.(absolute);
    else void window.qingwu?.showItemInFolder?.(absolute);
  };

  return (
    <div className="native-deliv-card">
      <button
        type="button"
        className="native-deliv-main"
        onClick={() => onOpenFile?.(file.path)}
        title={file.path}
      >
        <span className="native-deliv-glyph">
          <FileGlyph info={info} size={18} />
        </span>
        <span className="native-deliv-text">
          <span className="native-deliv-name">{basename(file.path)}</span>
          {file.description && (
            <span className="native-deliv-desc" title={file.description}>
              {file.description}
            </span>
          )}
        </span>
      </button>
      <span className="native-deliv-actions">
        <button
          type="button"
          className="native-btn-ghost-xs"
          onClick={() => runAction("open")}
          title="用系统默认程序打开"
        >
          {feedback === "open" ? "已打开" : "打开"}
        </button>
        <button
          type="button"
          className="native-btn-ghost-xs"
          onClick={() => runAction("reveal")}
          title="在资源管理器中定位"
        >
          {feedback === "reveal" ? "已定位" : "定位"}
        </button>
      </span>
    </div>
  );
}
