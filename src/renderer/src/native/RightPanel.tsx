/**
 * 右侧面板壳（对齐官方 sidebar-right 的骨架语义）：
 * - 没有标题行，tab 条就是整条上边；右上角是全屏与收起两个面板控件；
 * - 两种形态：普通（会话区让位，宽度可拖）与全屏覆盖（窄窗自动全屏，
 *   窄屏退出全屏即收起）；
 * - 打开的页、选中页、宽度与呈现方式按会话存 localStorage；
 * - 展开且为空时播种「开始页」；开始页是该格的落点页、不画关闭控件；
 *   关闭最后一个非开始页时整列收起，布局回到空，下次展开再播种。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { basename, fileInfoOf } from "./panel/workspace-files";
import {
  defaultPanelLayout,
  loadPanelLayout,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  savePanelLayout,
  type PanelLayout,
  type PanelTab,
} from "./panel/layout";
import { PanelGuide } from "./panel/PanelGuide";
import { PanelFiles } from "./panel/PanelFiles";
import { PanelPreview } from "./panel/PanelPreview";
import {
  CompassIcon,
  FileGlyph,
  PanelCollapseIcon,
  PanelFullscreenIcon,
} from "./panel/glyphs";

export interface RightPanelHandle {
  /** 打开（或聚焦）工作区文件页；面板收起时先展开。 */
  openFiles: () => void;
  /** 打开（或聚焦）一个文件的预览页；面板收起时先展开。 */
  openFile: (path: string) => void;
}

export interface RightPanelProps {
  sessionId: string | null;
  /** 会话工作目录（文件树根、终端打开目标）。 */
  cwd?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 预览页点击图片时转交应用的大图浮层。 */
  onPreviewImage?: (url: string) => void;
}

/** 窗口低于该宽度时打开面板自动进入全屏形态（对齐官方断点）。 */
const NARROW_WINDOW_PX = 768;

export const RightPanel = forwardRef<RightPanelHandle, RightPanelProps>(
  function RightPanel(
    { sessionId, cwd, open, onOpenChange, onPreviewImage },
    ref,
  ) {
    const [layout, setLayout] = useState<PanelLayout>(defaultPanelLayout);
    const [narrow, setNarrow] = useState(
      () => window.innerWidth < NARROW_WINDOW_PX,
    );
    const [dragging, setDragging] = useState(false);
    /** 已为哪个会话载入过布局：避免切换会话的过渡期把默认布局写进存储。 */
    const loadedForRef = useRef<string | null>(null);
    /** 载入后吞掉一次持久化：setLayout 应用前的过渡帧会带着旧会话的布局。 */
    const skipPersistRef = useRef(false);

    // 每会话载入布局（展开态由父层持有并注入）
    useEffect(() => {
      loadedForRef.current = null;
      if (!sessionId) {
        skipPersistRef.current = true;
        setLayout(defaultPanelLayout());
        return;
      }
      const saved = loadPanelLayout(sessionId);
      skipPersistRef.current = true;
      setLayout(saved);
      loadedForRef.current = sessionId;
      if (saved.expanded !== open) onOpenChange(saved.expanded);
      // open 变化不触发重载：载入只跟随会话切换
    }, [sessionId]);

    // 布局或展开态变化即持久化（展开态并入存储，下次进会话还原）
    useEffect(() => {
      if (skipPersistRef.current) {
        skipPersistRef.current = false;
        return;
      }
      if (!sessionId || loadedForRef.current !== sessionId) return;
      savePanelLayout(sessionId, { ...layout, expanded: open });
    }, [sessionId, layout, open]);

    // 窗口宽度断点
    useEffect(() => {
      const onResize = () => setNarrow(window.innerWidth < NARROW_WINDOW_PX);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);

    // 展开（或收起后）时保证有内容：空布局播种开始页
    useEffect(() => {
      if (!open || !sessionId || layout.tabs.length > 0) return;
      setLayout((prev) =>
        prev.tabs.length > 0
          ? prev
          : { ...prev, tabs: [{ id: "guide", kind: "guide" }], activeTabId: "guide" },
      );
    }, [open, sessionId, layout.tabs.length]);

    const focusOrCreate = useCallback(
      (tab: PanelTab, opts?: { replaceGuide?: boolean }) => {
        setLayout((prev) => {
          if (prev.tabs.some((t) => t.id === tab.id)) {
            return { ...prev, activeTabId: tab.id };
          }
          let tabs = prev.tabs;
          const guideIndex = opts?.replaceGuide
            ? tabs.findIndex((t) => t.kind === "guide")
            : -1;
          if (guideIndex >= 0) {
            tabs = tabs.map((t, i) => (i === guideIndex ? tab : t));
          } else {
            tabs = [...tabs, tab];
          }
          return { ...prev, tabs, activeTabId: tab.id };
        });
      },
      [],
    );

    const openFiles = useCallback(() => {
      onOpenChange(true);
      focusOrCreate({ id: "files", kind: "files" }, { replaceGuide: true });
    }, [focusOrCreate, onOpenChange]);

    const openFile = useCallback(
      (path: string) => {
        if (!path) return;
        onOpenChange(true);
        focusOrCreate({ id: `preview:${path}`, kind: "preview", path });
      },
      [focusOrCreate, onOpenChange],
    );

    useImperativeHandle(ref, () => ({ openFiles, openFile }), [
      openFiles,
      openFile,
    ]);

    const closeTab = useCallback(
      (tabId: string) => {
        setLayout((prev) => {
          const index = prev.tabs.findIndex((t) => t.id === tabId);
          if (index < 0) return prev;
          const tabs = prev.tabs.filter((t) => t.id !== tabId);
          if (tabs.length === 0) {
            // 官方规则：关闭最后一个非开始页时整列收起，布局保持为空
            onOpenChange(false);
            return { ...prev, tabs, activeTabId: null };
          }
          const activeTabId =
            prev.activeTabId === tabId
              ? tabs[Math.min(index, tabs.length - 1)].id
              : prev.activeTabId;
          return { ...prev, tabs, activeTabId };
        });
      },
      [onOpenChange],
    );

    const fullscreen = layout.fullscreen || narrow;

    const toggleFullscreen = useCallback(() => {
      // 窄屏下全屏是自动形态：退出即收起（变宽不重新打开已关闭的面板）
      if (narrow) {
        onOpenChange(false);
        return;
      }
      setLayout((prev) => ({ ...prev, fullscreen: !prev.fullscreen }));
    }, [narrow, onOpenChange]);

    // 宽度拖拽（仅普通展开态显示）
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const onResizerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: layout.width };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    };
    const onResizerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const max = Math.min(PANEL_MAX_WIDTH, Math.floor(window.innerWidth * 0.5));
      const width = Math.min(
        max,
        Math.max(PANEL_MIN_WIDTH, drag.startWidth + (drag.startX - event.clientX)),
      );
      setLayout((prev) => ({ ...prev, width }));
    };
    const onResizerUp = (event: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    };

    if (!open) return null;

    return (
      <div
        className={`native-panel${fullscreen ? " fullscreen" : ""}${
          dragging ? " dragging" : ""
        }`}
        style={fullscreen ? undefined : { width: layout.width }}
        role="complementary"
        aria-label="工作区面板"
      >
        {!fullscreen && (
          <div
            className="native-panel-resizer"
            role="separator"
            aria-orientation="vertical"
            title="拖动调节宽度，双击复位"
            onPointerDown={onResizerDown}
            onPointerMove={onResizerMove}
            onPointerUp={onResizerUp}
            onDoubleClick={() =>
              setLayout((prev) => ({ ...prev, width: PANEL_DEFAULT_WIDTH }))
            }
          />
        )}
        <div className="native-panel-tabstrip" role="tablist">
          {layout.tabs.map((tab) => (
            <TabChip
              key={tab.id}
              tab={tab}
              active={tab.id === layout.activeTabId}
              onlyTab={layout.tabs.length === 1}
              onActivate={() =>
                setLayout((prev) => ({ ...prev, activeTabId: tab.id }))
              }
              onClose={() => closeTab(tab.id)}
            />
          ))}
          <span className="native-panel-strip-spacer" />
          <button
            type="button"
            className="native-icon-btn"
            onClick={toggleFullscreen}
            title={fullscreen ? "退出全屏" : "全屏"}
            aria-label={fullscreen ? "退出全屏" : "全屏"}
          >
            <PanelFullscreenIcon active={fullscreen} />
          </button>
          <button
            type="button"
            className="native-icon-btn"
            onClick={() => onOpenChange(false)}
            title="收起面板"
            aria-label="收起面板"
          >
            <PanelCollapseIcon />
          </button>
        </div>
        <div className="native-panel-body">
          {layout.tabs.map((tab) => (
            <div
              key={tab.id}
              className="native-panel-page"
              data-active={tab.id === layout.activeTabId || undefined}
              role="tabpanel"
            >
              {tab.kind === "guide" && (
                <PanelGuide
                  onOpenFiles={openFiles}
                  onOpenTerminal={() =>
                    void window.qingwu?.openTerminal?.(cwd ?? undefined)
                  }
                />
              )}
              {tab.kind === "files" && (
                <PanelFiles
                  sessionId={sessionId}
                  cwd={cwd}
                  onOpenFile={openFile}
                />
              )}
              {tab.kind === "preview" && (
                <PanelPreview
                  sessionId={sessionId}
                  path={tab.path}
                  onPreviewImage={onPreviewImage}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  },
);

/** tab 条上的一枚页签：开始页永远没有关闭控件；其余页关闭按钮悬停浮现。 */
function TabChip({
  tab,
  active,
  onlyTab,
  onActivate,
  onClose,
}: {
  tab: PanelTab;
  active: boolean;
  onlyTab: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const guideQuiet = tab.kind === "guide" && onlyTab;
  return (
    <div
      className={`native-panel-chip${active ? " active" : ""}${
        guideQuiet ? " quiet" : ""
      }`}
      role="tab"
      aria-selected={active}
      onClick={onActivate}
      title={tab.kind === "preview" ? tab.path : undefined}
    >
      <span className="native-panel-chip-icon">
        {tab.kind === "guide" && <CompassIcon size={13} />}
        {tab.kind === "files" && <FilesChipIcon />}
        {tab.kind === "preview" && <FileGlyph info={fileInfoOf(tab.path)} size={13} />}
      </span>
      <span className="native-panel-chip-label">
        {tab.kind === "guide" && "开始"}
        {tab.kind === "files" && "工作区文件"}
        {tab.kind === "preview" && basename(tab.path)}
      </span>
      {!guideQuiet && (
        <button
          type="button"
          className="native-panel-chip-close"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          title="关闭"
          aria-label={`关闭 ${tab.kind === "preview" ? basename(tab.path) : "页签"}`}
        >
          <svg
            viewBox="0 0 16 16"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

function FilesChipIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1.5 4.2c0-.94.76-1.7 1.7-1.7h2.9c.55 0 1.07.26 1.4.7l.55.73c.24.32.62.5 1.02.5h3.73c.94 0 1.7.77 1.7 1.7v6.17c0 .94-.76 1.7-1.7 1.7H3.2a1.7 1.7 0 0 1-1.7-1.7z"
        fill="#F0B429"
      />
      <path
        d="M1.5 5.6c0-.7.63-1.22 1.32-1.1l11.4 1.95c.51.09.88.53.88 1.05v5.8c0 .94-.76 1.7-1.7 1.7H3.2a1.7 1.7 0 0 1-1.7-1.7z"
        fill="#F6C445"
      />
    </svg>
  );
}
