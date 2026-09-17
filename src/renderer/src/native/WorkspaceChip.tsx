import { useEffect, useRef, useState } from "react";
import type { WorkspaceView } from "./protocol";

/**
 * 新会话引导页输入框上方的工作区 chip：点击弹出工作区列表 + 添加入口。
 * 只出现在引导页——会话一旦开出（有消息），工作区归属从侧栏分组即可看清，
 * 输入框上方不再常显项目名/选择器。
 */
export function WorkspaceChip({
  workspaces,
  currentId,
  fallbackLabel,
  onPick,
  onAdd,
}: {
  workspaces: WorkspaceView[];
  /** 当前绑定（空态为待落点）工作区 id；null 表示未绑定/未选择。 */
  currentId: string | null;
  /** 无绑定时的展示文案（未分组 / 选择工作区）。 */
  fallbackLabel: string;
  onPick: (workspaceId: string) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const label =
    workspaces.find((w) => w.workspaceId === currentId)?.title ?? fallbackLabel;

  return (
    <div className="native-ws-chip-wrap" ref={rootRef}>
      <button
        className={`native-ws-chip${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="选择工作区"
      >
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
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
        </svg>
        <span className="native-ws-chip-text">{label}</span>
        <svg
          className="native-ws-chip-chevron"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="native-ws-chip-menu">
          {workspaces.length === 0 && (
            <div className="native-popover-empty">暂无工作区</div>
          )}
          {workspaces.map((ws) => (
            <button
              key={ws.workspaceId}
              className={`native-popover-item${currentId === ws.workspaceId ? " active" : ""}`}
              onClick={() => {
                setOpen(false);
                onPick(ws.workspaceId);
              }}
              title={ws.path}
            >
              <span className="native-popover-item-name">{ws.title}</span>
            </button>
          ))}
          <div className="native-ws-chip-menu-sep" />
          <button
            className="native-popover-item"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
          >
            <span className="native-popover-item-name">添加工作区…</span>
          </button>
        </div>
      )}
    </div>
  );
}
