/**
 * 右侧面板的文件预览页：文本/代码按行分页（滚动到底自动加载下一页），
 * Markdown 直接渲染，图片读本地图（复用主进程既有读取通道），
 * 不支持的类型给出空态与系统打开入口。stat 成功后监听文件变化自动重载。
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceFileStat } from "../protocol";
import { toErrMsg } from "../rpc";
import { Markdown } from "../markdown";
import {
  basename,
  fileInfoOf,
  readTextPage,
  statFile,
  watchWorkspacePath,
  type FileTypeInfo,
} from "./workspace-files";
import { FileGlyph } from "./glyphs";
import { PathLabelParts } from "./PanelFiles";

/** 每页行数（引擎单页上限 5000，这里取较小值降低单次传输与渲染成本）。 */
const PAGE_LINES = 2000;
/** 代码/纯文本视图最多渲染的行数，超出部分提示在面板内查看完整内容。 */
const MAX_RENDER_LINES = 20000;

type PreviewState =
  | { phase: "loading" }
  | { phase: "unsupported"; stat: WorkspaceFileStat; info: FileTypeInfo }
  | { phase: "image"; stat: WorkspaceFileStat; dataUrl: string }
  | {
      phase: "text";
      stat: WorkspaceFileStat;
      info: FileTypeInfo;
      text: string;
      lines: number;
      eof: boolean;
      loadingMore: boolean;
    }
  | { phase: "missing"; message: string }
  | { phase: "failed"; message: string };

interface PanelPreviewProps {
  sessionId: string | null;
  /** 要预览的文件路径（绝对或相对会话工作区根）。 */
  path: string;
  /** 点击图片时把原图交给应用的大图浮层。 */
  onPreviewImage?: (url: string) => void;
}

export function PanelPreview({
  sessionId,
  path,
  onPreviewImage,
}: PanelPreviewProps) {
  const [state, setState] = useState<PreviewState>({ phase: "loading" });
  const [wrap, setWrap] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0);
  /** 自动刷新重读后要恢复的滚动位置（下一次内容渲染完成时消费）。 */
  const pendingScrollRef = useRef<number | null>(null);
  const stateRef = useRef<PreviewState>(state);
  stateRef.current = state;

  const info = fileInfoOf(path);

  /** 全量（重）载：清空当前内容重新读取。keepScroll 用于自动刷新不跳动。 */
  const load = useCallback(
    async (opts?: { keepScrollTop?: number }) => {
      const gen = ++genRef.current;
      if (!sessionId) {
        setState({ phase: "failed", message: "当前没有选中的会话" });
        return;
      }
      pendingScrollRef.current = opts?.keepScrollTop ?? null;
      setState({ phase: "loading" });
      try {
        const stat = await statFile(sessionId, path);
        if (gen !== genRef.current) return;
        const kind = fileInfoOf(path).kind;
        if (kind === "image") {
          const img = await window.qingwu?.readLocalImage?.(stat.absolutePath);
          if (gen !== genRef.current) return;
          if (!img) {
            setState({ phase: "failed", message: "图片读取失败" });
          } else {
            setState({ phase: "image", stat, dataUrl: img.dataUrl });
          }
        } else if (kind === "unsupported") {
          setState({ phase: "unsupported", stat, info: fileInfoOf(path) });
        } else {
          const page = await readTextPage(sessionId, path, {
            offset: 1,
            limit: PAGE_LINES,
          });
          if (gen !== genRef.current) return;
          setState({
            phase: "text",
            stat,
            info: fileInfoOf(path),
            text: page.text,
            lines: page.lines,
            eof: page.eof,
            loadingMore: false,
          });
        }
      } catch (err) {
        if (gen !== genRef.current) return;
        const message = toErrMsg(err);
        setState({
          phase: message.includes("workspace-file/not-found")
            ? "missing"
            : "failed",
          message: friendlyFileError(message),
        });
      }
    },
    [sessionId, path],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 内容渲染完成后恢复自动刷新保留的滚动位置
  useEffect(() => {
    if (pendingScrollRef.current == null) return;
    if (state.phase !== "text" && state.phase !== "image") {
      pendingScrollRef.current = null;
      return;
    }
    const top = pendingScrollRef.current;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = top;
    });
  }, [state]);

  /**
   * 监听当前文件：收到失效帧后重新 stat；版本没变（目录噪音）不动，
   * 变了就保留滚动位置重读；文件消失进入 missing 态。
   */
  useEffect(() => {
    if (!sessionId) return;
    return watchWorkspacePath(sessionId, path, {
      onChange: () => {
        // 初次读取尚未完成时忽略目录噪音，避免重载风暴
        if (stateRef.current.phase === "loading") return;
        void (async () => {
          try {
            const stat = await statFile(sessionId, path);
            const cur = stateRef.current;
            const curVersion =
              cur.phase === "text" ||
              cur.phase === "image" ||
              cur.phase === "unsupported"
                ? cur.stat.version
                : null;
            if (curVersion !== null && stat.version === curVersion) return;
            void load({ keepScrollTop: bodyRef.current?.scrollTop });
          } catch (err) {
            const message = toErrMsg(err);
            if (message.includes("workspace-file/not-found")) {
              setState({ phase: "missing", message: "文件已不存在或已被删除" });
            }
          }
        })();
      },
    });
  }, [sessionId, path, load]);

  const loadMore = useCallback(async () => {
    const cur = stateRef.current;
    if (
      !sessionId ||
      cur.phase !== "text" ||
      cur.eof ||
      cur.loadingMore ||
      cur.lines >= MAX_RENDER_LINES
    )
      return;
    setState((s) =>
      s.phase === "text" ? { ...s, loadingMore: true } : s,
    );
    try {
      const page = await readTextPage(sessionId, path, {
        offset: cur.lines + 1,
        limit: PAGE_LINES,
      });
      setState((s) => {
        if (s.phase !== "text") return s;
        const joined =
          s.text && page.text ? `${s.text}\n${page.text}` : s.text || page.text;
        return {
          ...s,
          text: joined,
          lines: s.lines + page.lines,
          eof: page.eof,
          loadingMore: false,
        };
      });
    } catch {
      setState((s) => (s.phase === "text" ? { ...s, loadingMore: false } : s));
    }
  }, [sessionId, path]);

  const handleBodyScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      const cur = stateRef.current;
      if (cur.phase !== "text" || cur.eof || cur.loadingMore) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) {
        void loadMore();
      }
    },
    [loadMore],
  );

  const openExternal = () => {
    const abs =
      state.phase === "text" ||
      state.phase === "image" ||
      state.phase === "unsupported"
        ? state.stat.absolutePath
        : null;
    void window.qingwu?.openPath?.(abs ?? path);
  };

  // 头部优先显示引擎解析出的绝对路径（符号链接已解析），尚未 stat 时显示请求路径
  const displayPath =
    state.phase === "text" ||
    state.phase === "image" ||
    state.phase === "unsupported"
      ? state.stat.absolutePath
      : path;

  return (
    <div className="panel-preview">
      <div className="panel-preview-header">
        <span className="panel-pathlabel" title={displayPath}>
          <PathLabelParts path={displayPath} />
        </span>
        <span className="panel-preview-actions">
          {(state.phase === "text" && state.info.kind !== "markdown") && (
            <button
              type="button"
              className="native-icon-btn"
              onClick={() => setWrap((v) => !v)}
              title={wrap ? "切换为不换行" : "切换为自动换行"}
              aria-pressed={wrap}
            >
              <WrapIcon />
            </button>
          )}
          <button
            type="button"
            className="native-icon-btn"
            onClick={() => void load()}
            title="重新载入"
            aria-label="重新载入"
          >
            <ReloadIcon />
          </button>
          <button
            type="button"
            className="native-icon-btn"
            onClick={openExternal}
            title="用系统默认程序打开"
            aria-label="用系统默认程序打开"
          >
            <OpenExternalIcon />
          </button>
        </span>
      </div>
      <div className="panel-preview-body" ref={bodyRef} onScroll={handleBodyScroll}>
        {state.phase === "loading" && (
          <div className="panel-preview-center">
            <span className="panel-spinner" aria-hidden="true" />
            <span>文档加载中…</span>
          </div>
        )}
        {state.phase === "missing" && (
          <div className="panel-preview-center">
            <FileGlyph info={info} size={28} />
            <span>{state.message}</span>
          </div>
        )}
        {state.phase === "failed" && (
          <div className="panel-preview-center">
            <FileGlyph info={info} size={28} />
            <span>{state.message}</span>
            <button
              type="button"
              className="native-btn-ghost-sm"
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        )}
        {state.phase === "unsupported" && (
          <div className="panel-preview-center">
            <FileGlyph info={state.info} size={28} />
            <span>此文件类型暂不支持在面板内预览</span>
            <button
              type="button"
              className="native-btn-ghost-sm"
              onClick={openExternal}
            >
              用系统默认程序打开
            </button>
          </div>
        )}
        {state.phase === "image" && (
          <div className="panel-preview-image">
            <img
              src={state.dataUrl}
              alt={basename(path)}
              onClick={() => onPreviewImage?.(state.dataUrl)}
            />
          </div>
        )}
        {state.phase === "text" && state.info.kind === "markdown" && (
          <div className="panel-preview-md">
            <Markdown text={state.text} />
          </div>
        )}
        {state.phase === "text" && state.info.kind !== "markdown" && (
          <CodeRows text={state.text} info={state.info} wrap={wrap} />
        )}
        {state.phase === "text" && !state.eof && (
          <button
            type="button"
            className="panel-load-more"
            disabled={state.loadingMore}
            onClick={() => void loadMore()}
          >
            {state.loadingMore ? "加载中…" : "加载更多"}
          </button>
        )}
      </div>
    </div>
  );
}

/** 代码/纯文本行渲染：行号 + 内容；行块 memo 化，自动刷新重渲染不重建 DOM。 */
const CodeRows = memo(function CodeRows({
  text,
  info,
  wrap,
}: {
  text: string;
  info: FileTypeInfo;
  wrap: boolean;
}) {
  const allLines = text.length > 0 ? text.split("\n") : [];
  const overflow = allLines.length > MAX_RENDER_LINES;
  const lines = overflow ? allLines.slice(0, MAX_RENDER_LINES) : allLines;
  return (
    <div className={`panel-code${wrap ? " wrap" : ""}`}>
      {lines.map((line, index) => (
        <div className="panel-code-row" key={index}>
          <span className="panel-code-no">{index + 1}</span>
          <span className="panel-code-ln">{line || " "}</span>
        </div>
      ))}
      {overflow && (
        <div className="panel-code-row">
          <span className="panel-code-no" />
          <span className="panel-code-ln muted">
            内容过长，仅显示前 {MAX_RENDER_LINES} 行
          </span>
        </div>
      )}
      {lines.length === 0 && (
        <div className="panel-code-row">
          <span className="panel-code-no">1</span>
          <span className="panel-code-ln muted">（空文件）</span>
        </div>
      )}
      <span className="panel-code-kind" aria-hidden="true">
        {info.badge === "code" ? info.label : "TXT"}
      </span>
    </div>
  );
});

function friendlyFileError(message: string): string {
  if (message.includes("workspace-file/not-found")) return "文件不存在";
  if (message.includes("workspace-file/not-text")) return "不是文本文件";
  if (message.includes("workspace-file/too-large")) return "文件超出可读取的大小上限";
  if (message.includes("not-regular-file")) return "不是普通文件";
  if (message.includes("outside-workspace")) return "路径超出工作区范围";
  return message;
}

function WrapIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M2.5 8h8.5a2.5 2.5 0 0 1 0 5H9" />
      <path d="m10.5 11.5-1.8 1.5 1.8 1.5" transform="translate(0,-1.5)" />
      <path d="M2.5 12h3.5" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.7 1.8v2.7h-2.7" />
    </svg>
  );
}

function OpenExternalIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
      <path d="M9 2h5v5M6.5 9.5 14 2" />
    </svg>
  );
}
