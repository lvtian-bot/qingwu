/**
 * 工作区文件数据层：封装引擎 workspaceFiles Remote 命名空间的调用与监听，
 * 供右侧面板的文件树与预览页共用。线上契约见 protocol.ts 的 workspaceFiles 段
 * （与已安装引擎 @deepseek-ai/dsh-api-workspace-files 的公开 types 出口对齐）。
 */
import { rpc, toErrMsg } from "../rpc";
import {
  Endpoints,
  type WorkspaceDirectoryListing,
  type WorkspaceFileStat,
  type WorkspaceFileTextPage,
  type WorkspaceWatchFrame,
} from "../protocol";

const qingwu = window.qingwu;

/** 列举一个目录的直接子项。path 传会话工作区内的绝对或相对路径，根目录可用工作区根本身。 */
export function listDirectory(
  sessionId: string,
  path: string,
): Promise<WorkspaceDirectoryListing> {
  return rpc<WorkspaceDirectoryListing>(Endpoints.workspaceFilesList, {
    workspaceFileScopeId: sessionId,
    path,
  });
}

/** 读取一个普通文件的身份、版本与大小（不含内容）。 */
export function statFile(
  sessionId: string,
  path: string,
): Promise<WorkspaceFileStat> {
  return rpc<WorkspaceFileStat>(Endpoints.workspaceFilesStat, {
    workspaceFileScopeId: sessionId,
    path,
  });
}

/** 读取一个 UTF-8 文本文件的一个行窗口（1 起算）。 */
export function readTextPage(
  sessionId: string,
  path: string,
  range: { offset?: number; limit?: number } = {},
): Promise<WorkspaceFileTextPage> {
  return rpc<WorkspaceFileTextPage>(Endpoints.workspaceFilesRead, {
    workspaceFileScopeId: sessionId,
    path,
    range,
  });
}

export interface WatchHandlers {
  /** 监听就绪（首批变化已开始排队）。 */
  onReady?: () => void;
  /** 目标失效：文件版本变化或消失，目录子项变化。 */
  onChange: () => void;
  /** 流结束或出错（引擎侧关闭、会话释放等）；不再自动重连。 */
  onEnded?: (message?: string) => void;
}

/**
 * 打开一条 workspaceFiles/changes 监听流。桥把 error/end 终态帧转译成
 * stream/error、stream/end 值并保留流注册，因此这里收到终态后主动 cancel。
 * 返回值是解除函数：取消流并退订，幂等。
 */
export function watchWorkspacePath(
  sessionId: string,
  path: string,
  handlers: WatchHandlers,
): () => void {
  let streamId: string | null = null;
  let disposed = false;

  const dispose = () => {
    disposed = true;
    if (streamId) {
      qingwu.dshStreamCancel(streamId);
      streamId = null;
    }
    unsubscribe();
  };

  const unsubscribe = qingwu.onDshStreamItem(({ streamId: id, endpoint, value }) => {
    if (disposed || id !== streamId || endpoint !== Endpoints.workspaceFilesChanges)
      return;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "stream/error") {
        const err = record.error as { message?: string } | undefined;
        dispose();
        handlers.onEnded?.(err?.message);
        return;
      }
      if (record.type === "stream/end") {
        dispose();
        handlers.onEnded?.();
        return;
      }
      const frame = value as WorkspaceWatchFrame;
      if (frame.kind === "ready") handlers.onReady?.();
      else if (frame.kind === "change") handlers.onChange();
    }
  });

  qingwu.dshStreamOpen(Endpoints.workspaceFilesChanges, {
    workspaceFileScopeId: sessionId,
    path,
  })
    .then((id) => {
      if (disposed) {
        qingwu.dshStreamCancel(id);
        return;
      }
      streamId = id;
    })
    .catch((err) => {
      if (!disposed) {
        dispose();
        handlers.onEnded?.(toErrMsg(err));
      }
    });

  return dispose;
}

/** 以会话工作目录为基准把工作区相对路径折算成绝对路径；绝对路径原样返回。 */
export function resolveAgainstCwd(
  cwd: string | null | undefined,
  path: string,
): string {
  if (!path) return path;
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/"))
    return path;
  if (!cwd) return path;
  const base = cwd.replace(/[\\/]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${path.replace(/^[\\/]+/, "")}`;
}

/** 目录内使用的稳定自然序：目录优先，其后按名称自然序、不分大小写。 */
export const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 路径按原始分隔符拆成目录段与末段（路径标签展示用）。 */
export function splitPathDisplay(path: string): { dir: string; base: string } {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return { dir: "", base: path };
  return { dir: path.slice(0, index + 1), base: path.slice(index + 1) };
}

// ---------- 预览分类 ----------

export type PreviewKind = "markdown" | "code" | "text" | "image" | "unsupported";

const MARKDOWN_EXTS = new Set(["md", "markdown"]);
const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "py", "rb", "go",
  "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "php",
  "sh", "bash", "bat", "cmd", "ps1", "psm1", "sql", "html", "htm", "css",
  "scss", "less", "yml", "yaml", "toml", "xml", "vue", "svelte", "lua",
  "r", "dart", "scala", "hs", "ex", "exs", "erl", "clj", "graphql", "ini",
  "cfg", "conf", "properties", "gitignore", "dockerfile",
]);
const TEXT_EXTS = new Set(["txt", "log", "csv", "tsv", "text", "nfo"]);
const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "svg", "avif",
]);

export interface FileTypeInfo {
  name: string;
  ext: string;
  kind: PreviewKind;
  /** 交付卡片与预览空态用的类别徽标（决定配色与文案）。 */
  badge: "doc" | "sheet" | "slide" | "pdf" | "image" | "text" | "code" | "zip" | "file";
  label: string;
}

export function fileInfoOf(path: string): FileTypeInfo {
  const name = basename(path);
  const match = name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = match ? match[1].toLowerCase() : "";
  const upper = ext.toUpperCase();

  if (ext === "doc" || ext === "docx" || ext === "rtf" || ext === "odt")
    return { name, ext, kind: "unsupported", badge: "doc", label: "DOC" };
  if (ext === "xls" || ext === "xlsx" || ext === "ods")
    return { name, ext, kind: "unsupported", badge: "sheet", label: "XLS" };
  if (ext === "csv" || ext === "tsv")
    return { name, ext, kind: "text", badge: "sheet", label: upper };
  if (ext === "ppt" || ext === "pptx" || ext === "odp")
    return { name, ext, kind: "unsupported", badge: "slide", label: "PPT" };
  if (ext === "pdf")
    return { name, ext, kind: "unsupported", badge: "pdf", label: "PDF" };
  if (IMAGE_EXTS.has(ext))
    return { name, ext, kind: "image", badge: "image", label: upper || "IMG" };
  if (MARKDOWN_EXTS.has(ext))
    return { name, ext, kind: "markdown", badge: "text", label: "MD" };
  if (CODE_EXTS.has(ext))
    return { name, ext, kind: "code", badge: "code", label: upper };
  if (TEXT_EXTS.has(ext))
    return { name, ext, kind: "text", badge: "text", label: upper || "TXT" };
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext))
    return { name, ext, kind: "unsupported", badge: "zip", label: upper };
  return { name, ext, kind: "unsupported", badge: "file", label: upper || "FILE" };
}
