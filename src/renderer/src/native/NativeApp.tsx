import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ApprovalRequestPayload,
  AssistantBlockDelta,
  AssistantChunkEventData,
  AssistantMessageData,
  AssistantStreamRecord,
  ContextBreakdownProjection,
  ContextPressureProjection,
  EditArgs,
  InboxMessage,
  InboxSplicedEventData,
  ImageAttachmentRef,
  ModelCatalog,
  ModelSelection,
  PermissionSelect,
  PresetOption,
  QueueAction,
  RemoteEventFrame,
  SessionAttachmentResult,
  SessionEvent,
  SessionFollowFrame,
  SessionSummary,
  SettingsDescribeValue,
  ToolCallEventData,
  ToolResultEventData,
  TodoWriteArgs,
  UserQuestionAnswer,
  UserQuestionsRequestPayload,
  WriteArgs,
  WorkspaceFollowFrame,
  WorkspaceView,
} from "./protocol";
import { Endpoints } from "./protocol";
import type {
  DshRpcResult,
  DshStreamItem,
  UiMode,
} from "../../../shared/types";
import { Markdown } from "./markdown";
import { ChevronDownIcon } from "./native-icons";
import { ReasoningRow } from "./ReasoningRow";
import { ToolCard, type ToolItem } from "./ToolCard";
import { RightPanel, PanelIcon, type FileChangeEntry, type TodoEntry } from "./RightPanel";
import { usePanelWidth } from "./usePanelWidth";
import "./native.css";

const qingwu = window.qingwu;

async function rpc<T>(endpoint: string, payload: unknown): Promise<T> {
  const result = (await qingwu.dshCall(endpoint, payload)) as
    DshRpcResult<T> | undefined;
  if (!result || typeof result.ok !== "boolean") {
    throw new Error(`${endpoint} 返回非法结果`);
  }
  if (!result.ok) {
    throw new Error(
      `${endpoint} 失败: ${result.error?.code ?? "unknown"} ${result.error?.message ?? ""}`,
    );
  }
  return result.value;
}

/** 按块类型提取可展示文本（text / reasoning 块均携带 text 字段）。 */
function textOf(content: unknown[], blockType: "text" | "reasoning"): string {
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type: unknown }).type === blockType &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/** 草稿中附加的图片项。 */
export interface DraftImage {
  id: string;
  file: File;
  previewUrl: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  name: string;
  base64?: string;
}

/** 消息（用户或队列）中展示的图片项。 */
export interface MessageImageItem {
  id?: string;
  url?: string;
  attachmentId?: string;
  mediaType?: string;
  name?: string;
  width?: number;
  height?: number;
}

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_IMAGES_PER_MESSAGE = 20;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

function isSupportedImage(file: File): boolean {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif";
}

function getImageMediaType(file: File): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  if (file.type === "image/png") return "image/png";
  if (file.type === "image/jpeg" || file.type === "image/jpg") return "image/jpeg";
  if (file.type === "image/webp") return "image/webp";
  if (file.type === "image/gif") return "image/gif";
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex !== -1 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function base64ToBlobUrl(base64: string, mediaType: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mediaType }));
  } catch {
    return `data:${mediaType};base64,${base64}`;
  }
}

/** 缓存已加载的持久化图片 Blob URL，避免重复调用 RPC */
const attachmentUrlCache = new Map<string, string>();

/** 消息内图片展示项：支持 blob 预览 URL 与宿主 attachmentId 按需异步加载。 */
function MessageImageView({
  image,
  sessionId,
  onPreview,
}: {
  image: MessageImageItem;
  sessionId?: string | null;
  onPreview?: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(image.url ?? null);
  const [loading, setLoading] = useState(!image.url && !!image.attachmentId);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (image.url) {
      setSrc(image.url);
      setLoading(false);
      return;
    }
    if (!image.attachmentId || !sessionId) return;

    const cacheKey = `${sessionId}:${image.attachmentId}`;
    const cached = attachmentUrlCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(false);

    rpc<SessionAttachmentResult>(Endpoints.sessionAttachment, {
      request: {
        sessionId,
        attachmentId: image.attachmentId,
      },
    })
      .then((res) => {
        if (!active) return;
        const blobUrl = base64ToBlobUrl(
          res.data,
          res.attachment?.mediaType || "image/png",
        );
        attachmentUrlCache.set(cacheKey, blobUrl);
        setSrc(blobUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [image.url, image.attachmentId, sessionId]);

  if (error) {
    return (
      <div className="native-msg-image-error" title="图片加载失败">
        <span>图片加载失败</span>
      </div>
    );
  }

  if (loading || !src) {
    return (
      <div className="native-msg-image-loading" title="图片加载中...">
        <div className="native-spinner" />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="native-msg-image-btn"
      onClick={() => onPreview?.(src)}
      title="点击查看原图"
    >
      <img src={src} alt="" draggable={false} />
    </button>
  );
}

/** 大图灯箱预览模态框。 */
function LightboxModal({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="native-lightbox-overlay" onClick={onClose}>
      <div
        className="native-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt="图片预览" />
        <button
          type="button"
          className="native-lightbox-close"
          onClick={onClose}
          title="关闭 (Esc)"
          aria-label="关闭预览"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * 把重连基线里的压实记录展开回逐条增量。
 * 引擎（0.1.5 起）不再把过程内增量写进日志，中途切回正在输出的会话时，
 * 「已经写了一段的文本」和「已经想了一段的推理」只能从开场基线的压实记录还原。
 */
function expandStreamRecords(
  records: AssistantStreamRecord[],
): AssistantBlockDelta[] {
  const deltas: AssistantBlockDelta[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (record.type === "chunk") {
      if (record.chunk) deltas.push(record.chunk);
      continue;
    }
    const members =
      record.type === "tool-call-chunks" ? record.args : record.texts;
    if (!Array.isArray(members)) continue;
    members.forEach((member) => {
      if (typeof member !== "string") return;
      if (record.type === "text-chunks") {
        deltas.push({ type: "text-delta", index: record.index, text: member });
      } else if (record.type === "reasoning-chunks") {
        deltas.push({
          type: "reasoning-delta",
          index: record.index,
          text: member,
        });
      } else {
        deltas.push({
          type: "tool-call-delta",
          index: record.index,
          id: record.id,
          ...(record.name ? { name: record.name } : {}),
          argumentsDelta: member,
        });
      }
    });
  }
  return deltas;
}

/**
 * 上下文占用（官方 contextOccupancy 口径）：分子优先用 projectedTokens
 * （最后一次采样 + 采样后表面的启发式增减），拿不到采样或路线容量时不显示。
 */
function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): { percent: number; usedTokens: number; contextWindow: number } | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null;
  return {
    percent: Math.min(
      100,
      Math.round((usedTokens / pressure.contextWindow) * 100),
    ),
    usedTokens,
    contextWindow: pressure.contextWindow,
  };
}

/** 紧凑 token 计数（官方口径：<1e3 原样，<1e6 用 K，否则 M；≥100 取整否则一位小数）。 */
function formatTokens(value: number): string {
  const scaled = (candidate: number) =>
    candidate >= 100
      ? String(Math.round(candidate))
      : String(Math.round(candidate * 10) / 10);
  if (value < 1000) return String(value);
  if (value < 1000000) return `${scaled(value / 1000)}K`;
  return `${scaled(value / 1000000)}M`;
}

/** 构成行（顺序即进度条分段顺序，颜色与图例一致）。 */
const CONTEXT_ROWS: {
  key: keyof ContextBreakdownProjection;
  label: string;
  tint: string;
}[] = [
  { key: "systemTokens", label: "系统提示词", tint: "system" },
  { key: "toolsTokens", label: "工具定义", tint: "tools" },
  { key: "messageTokens", label: "对话消息", tint: "messages" },
];

/** 环几何：与官方一致（14px 视窗、2px 描边、半径 5.5）。 */
const METER_RADIUS = 5.5;
const METER_CIRCUMFERENCE = 2 * Math.PI * METER_RADIUS;

/**
 * 会移动上下文占用/用量投影的会话事件：request/context 带来路线容量、
 * request/header 带来工具定义价格、assistant 结算带来提供方 usage 采样，
 * 其余可见表面（消息、工具结果）改变表面 token 总量，压缩则成段替换表面。
 */
const CONTEXT_METER_EVENTS = new Set([
  "request/context",
  "request/header",
  "assistant/message",
  "assistant/attempt",
  "tool/result",
  "system/message",
]);

function movesContextMeter(type: string): boolean {
  return CONTEXT_METER_EVENTS.has(type) || type.startsWith("compaction/");
}

/**
 * 上下文占用环 + 构成面板（对齐官方 ContextMeter）：环贴发送按钮，
 * 悬停显示百分比、点击展开系统提示词／工具定义／对话消息的构成。
 * 提供方既没报压力也没报路线容量时整块不渲染（官方同此）。
 */
function ContextMeter({
  pressure,
  breakdown,
}: {
  pressure?: ContextPressureProjection;
  breakdown?: ContextBreakdownProjection;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const occupancy = contextOccupancy(pressure);
  const available = occupancy !== null;

  useEffect(() => {
    if (!available && open) setOpen(false);
  }, [available, open]);

  // 点击面板外或按 Esc 收起（与官方同）
  useEffect(() => {
    if (!open || !available) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target) === true
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [available, open]);

  if (occupancy === null) return null;

  const percent = occupancy.percent;
  const total = breakdown
    ? breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
    : 0;
  const segments =
    !breakdown || total === 0
      ? [{ key: "total", tint: "", width: percent }]
      : CONTEXT_ROWS.map((row) => ({
          key: row.key,
          tint: row.tint,
          width: (percent * breakdown[row.key]) / total,
        })).filter((segment) => segment.width > 0);

  return (
    <span className="native-meter" ref={rootRef}>
      <button
        type="button"
        className="native-meter-trigger"
        aria-label={`上下文已用 ${percent}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`上下文已用 ${percent}%`}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle
            className="native-meter-track"
            cx="7"
            cy="7"
            r={METER_RADIUS}
          />
          <circle
            className="native-meter-fill"
            cx="7"
            cy="7"
            r={METER_RADIUS}
            strokeDasharray={`${(METER_CIRCUMFERENCE * percent) / 100} ${METER_CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>
      {open && (
        <div className="native-meter-panel" role="dialog" aria-label="上下文已用">
          <div className="native-meter-head">
            <span className="native-meter-headline">上下文已用</span>
            <span className="native-meter-percent">{percent}%</span>
            <span className="native-meter-figures">
              ~{formatTokens(occupancy.usedTokens)} /{" "}
              {formatTokens(occupancy.contextWindow)}
            </span>
          </div>
          <div className="native-meter-bar">
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={
                  segment.tint
                    ? `native-meter-segment ${segment.tint}`
                    : "native-meter-segment"
                }
                style={{ width: `${segment.width}%` }}
              />
            ))}
          </div>
          {breakdown && (
            <dl className="native-meter-rows">
              {CONTEXT_ROWS.map((row) => (
                <div className="native-meter-row" key={row.key}>
                  <dt>
                    <span
                      className={`native-meter-swatch ${row.tint}`}
                      aria-hidden="true"
                    />
                    {row.label}
                  </dt>
                  <dd>~{formatTokens(breakdown[row.key])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </span>
  );
}

/** 毫秒 → 「3m 55s」/「42s」。 */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** 助手消息复制按钮：点击后 1.5s 内显示「已复制」。 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="native-msg-action"
      title="复制回复"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied && <span>已复制</span>}
    </button>
  );
}

/**
 * 整轮过程折叠行（对齐官方「已思考 · N 次工具调用」）：
 * 一轮收束后，把答复之前的思考与执行收进这一行，点开才铺开。
 */
function TurnProcessRow({
  toolCount,
  messageCount,
  open,
  onToggle,
}: {
  toolCount: number;
  messageCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  const labels: string[] = [];
  if (toolCount > 0) labels.push(`${toolCount} 次工具调用`);
  if (messageCount > 0) labels.push(`${messageCount} 条消息`);
  return (
    <button
      type="button"
      className="native-turn-process"
      data-open={open || undefined}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="native-turn-process-label">
        {labels.length === 0 ? "已思考" : labels.join(" · ")}
      </span>
      <ChevronDownIcon className="native-turn-process-chevron" />
    </button>
  );
}

/** 一条助手消息的正文与元信息行。 */
function AssistantBody({ item }: { item: Extract<ChatItem, { kind: "assistant" }> }) {
  return (
    <>
      {(item.text || item.interrupted) && (
        <div className="native-msg-body">
          <Markdown text={item.text} />
          {item.interrupted && !item.text && (
            <span className="native-muted">（已中断）</span>
          )}
        </div>
      )}
      {item.text && (
        <div className="native-msg-meta">
          {item.startTime != null && (
            <span>用时 {formatDuration(item.time - item.startTime)}</span>
          )}
          <span style={{ flex: 1 }} />
          <CopyButton text={item.text} />
        </div>
      )}
    </>
  );
}

/**
 * 一轮会话的渲染：按轮次把过程与答复分开——过程（思考、工具调用、中间消息）
 * 在轮次收束后收进折叠行，答复永远直接显示。
 */
function TurnItems({
  view,
  cwd,
  sessionId,
  onPreviewImage,
}: {
  view: TurnView;
  cwd?: string;
  sessionId?: string | null;
  onPreviewImage?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const renderItem = (item: MarkedChatItem, showReasoning = true) => {
    if (item.kind === "tool") {
      return <ToolCard key={item.key} tool={item.tool} cwd={cwd} />;
    }
    if (item.kind === "assistant") {
      // 思考行的显示由调用方决定：过程折叠行收起时，思考已经由那一行代表，
      // 答复里再挂一条「思考」就是同一段推理重复两遍（对齐官方：过程行接管）。
      if (!item.text && !(showReasoning && item.reasoning) && !item.interrupted) {
        return null;
      }
      return (
        <div key={item.key} className="native-msg assistant">
          {showReasoning && item.reasoning && (
            <ReasoningRow text={item.reasoning} />
          )}
          <AssistantBody item={item} />
        </div>
      );
    }
    return (
      <div key={item.key} className="native-msg user">
        <div className="native-msg-user-wrap">
          {item.images && item.images.length > 0 && (
            <div className="native-msg-images">
              {item.images.map((img, idx) => (
                <MessageImageView
                  key={img.id || img.attachmentId || idx}
                  image={img}
                  sessionId={sessionId}
                  onPreview={onPreviewImage}
                />
              ))}
            </div>
          )}
          {item.text && <div className="native-msg-body">{item.text}</div>}
        </div>
      </div>
    );
  };

  // 没收束完整一轮（运行中、或整轮没有答复）时照旧逐条显示，不折叠
  if (!view.foldable || !view.answer) {
    return <>{view.items.map((item) => renderItem(item))}</>;
  }
  return (
    <>
      <TurnProcessRow
        toolCount={view.toolCount}
        messageCount={view.messageCount}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="native-turn-process-items">
          {view.context.map((item) => renderItem(item))}
        </div>
      )}
      {/* 折叠行收起时思考由它代表，展开后答复里的思考行照常显示 */}
      {renderItem(view.answer, open)}
    </>
  );
}

interface ComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  running: boolean;
  onStop: () => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  /** 工具行左侧控件（模型/强度/权限选择器）。 */
  controls?: ReactNode;
  /** 上下文占用环（贴发送按钮；无提供方用量时自身不渲染）。 */
  meter?: ReactNode;
  draftImages: DraftImage[];
  onRemoveDraftImage: (id: string) => void;
  onAddImages: (files: File[]) => void;
  onPreviewImage: (url: string) => void;
}

/**
 * 侧栏工作区行：胶囊底色 + 文件夹图标，点击主体展开/收起会话列表；
 * 悬停浮现「新建会话」与「···」操作菜单（重命名 / 删除），对齐 ChatGPT 桌面版项目分组。
 */
function WorkspaceRow({
  workspace,
  collapsed,
  pinned,
  onToggle,
  onNewSession,
  onRename,
  onDelete,
  onTogglePin,
}: {
  workspace: WorkspaceView;
  collapsed: boolean;
  pinned?: boolean;
  onToggle: () => void;
  onNewSession: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(workspace.title);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // 工作区标题更新（rename 后 follow 流推送）时同步草稿，避免下一次编辑带回旧值
  useEffect(() => {
    if (!renaming) setDraftTitle(workspace.title);
  }, [workspace.title, renaming]);

  const commitRename = () => {
    const next = draftTitle.trim();
    setRenaming(false);
    if (next && next !== workspace.title) onRename(next);
    else setDraftTitle(workspace.title);
  };

  return (
    <div
      className={`native-ws-row${collapsed ? " collapsed" : ""}`}
      ref={rootRef}
    >
      {renaming ? (
        <input
          className="native-ws-rename"
          value={draftTitle}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
            if (e.key === "Escape") {
              setDraftTitle(workspace.title);
              setRenaming(false);
            }
          }}
          onBlur={commitRename}
          aria-label="工作区名称"
        />
      ) : (
        <>
          <button
            className="native-ws-main"
            onClick={onToggle}
            title={workspace.path}
          >
            {/* 文件夹图标即展开/收起状态指示：展开显示打开的文件夹，收起显示关闭的 */}
            <svg
              className="native-ws-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {collapsed ? (
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
              ) : (
                <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
              )}
            </svg>
            <span className="native-ws-title">{workspace.title}</span>
          </button>
          <button
            className="native-ws-act"
            onClick={onNewSession}
            title={`在“${workspace.title}”中新建会话`}
            aria-label={`在“${workspace.title}”中新建会话`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {onTogglePin && (
            <button
              className={`native-ws-act${pinned ? " pinned" : ""}`}
              onClick={onTogglePin}
              title={pinned ? "取消置顶项目" : "置顶项目"}
              aria-label={pinned ? "取消置顶项目" : "置顶项目"}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill={pinned ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="17" x2="12" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V5h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v5.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z" />
              </svg>
            </button>
          )}
          <button
            className={`native-ws-act${menuOpen ? " visible" : ""}`}
            onClick={() => {
              setMenuOpen((v) => !v);
              setConfirmDelete(false);
            }}
            title="工作区操作"
            aria-label={`工作区“${workspace.title}”的操作`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          {menuOpen && !confirmDelete && (
            <div className="native-ws-menu">
              {onTogglePin && (
                <button
                  className="native-popover-item"
                  onClick={() => {
                    onTogglePin();
                    setMenuOpen(false);
                  }}
                >
                  <span className="native-popover-item-name">
                    {pinned ? "取消置顶项目" : "置顶项目"}
                  </span>
                </button>
              )}
              <button
                className="native-popover-item"
                onClick={() => {
                  setRenaming(true);
                  setMenuOpen(false);
                }}
              >
                <span className="native-popover-item-name">重命名工作区</span>
              </button>
              <button
                className="native-popover-item native-ws-menu-delete"
                onClick={() => setConfirmDelete(true)}
              >
                <span className="native-popover-item-name">删除工作区</span>
              </button>
            </div>
          )}
          {menuOpen && confirmDelete && (
            <div className="native-ws-menu">
              <div className="native-ws-confirm-text">
                将把“{workspace.title}
                ”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。
              </div>
              <div className="native-ws-confirm-actions">
                <button
                  className="native-ws-confirm-cancel"
                  onClick={() => {
                    setConfirmDelete(false);
                    setMenuOpen(false);
                  }}
                >
                  取消
                </button>
                <button
                  className="native-ws-confirm-go"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDelete(false);
                    onDelete();
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 侧栏置顶数据持久化 Key。 */
const PINNED_STORAGE_KEY = "qingwu.native.pinned";

interface PinnedData {
  workspaces: string[];
  sessions: string[];
}

function loadPinnedData(): PinnedData {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        workspaces: Array.isArray(parsed?.workspaces) ? parsed.workspaces : [],
        sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      };
    }
  } catch {}
  return { workspaces: [], sessions: [] };
}

function savePinnedData(data: PinnedData) {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

/**
 * 新会话引导页输入框上方的工作区 chip：点击弹出工作区列表 + 添加入口。
 * 只出现在引导页——会话一旦开出（有消息），工作区归属从侧栏分组即可看清，
 * 输入框上方不再常显项目名/选择器。
 */
function WorkspaceChip({
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

/** 输入框高度上限，与 .native-composer-box textarea 的 max-height 一致（超出后内部滚动）。 */
const COMPOSER_MAX_HEIGHT = 200;

/**
 * 输入框随内容自适应高度：空态保持在 CSS 最小高度（两行），长文本长到上限为止。
 * 内容变化不只有键盘输入（切换会话载入草稿、发送后清空、发送失败写回都会改 value），
 * 所以按 value 统一拟合，不要只在 onChange 里调。
 */
function fitComposerHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
}

/** 卡片式输入框：textarea + 底部工具行（左侧选择器 + 圆形发送/停止按钮），空态与底部共用。 */
function Composer({
  input,
  onInputChange,
  onSend,
  running,
  onStop,
  textareaRef,
  controls,
  meter,
  draftImages,
  onRemoveDraftImage,
  onAddImages,
  onPreviewImage,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // textareaRef 稳定，装填新元素时也会重跑，草稿首帧即按内容展开
  useEffect(() => {
    fitComposerHeight(textareaRef.current);
  }, [input, textareaRef]);

  const canSend = !!input.trim() || draftImages.length > 0;

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;
    const imageFiles: File[] = [];
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (isSupportedImage(file)) imageFiles.push(file);
      }
    } else if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file && isSupportedImage(file)) imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length > 0) {
      // 阻止冒泡至全局 window.onpaste，防止单次粘贴触发两次添加
      e.stopPropagation();
      onAddImages(imageFiles);
      const text = clipboardData.getData("text/plain");
      if (!text) {
        e.preventDefault();
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const imageFiles: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (isSupportedImage(file)) {
          imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        onAddImages(imageFiles);
      }
    }
  };

  return (
    <div
      className="native-composer-box"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {draftImages.length > 0 && (
        <div className="native-composer-attachments">
          {draftImages.map((img) => (
            <div key={img.id} className="native-composer-attachment-item">
              <button
                type="button"
                className="native-composer-thumb-btn"
                onClick={() => onPreviewImage(img.previewUrl)}
                title="点击预览大图"
              >
                <img src={img.previewUrl} alt="" draggable={false} />
              </button>
              <button
                type="button"
                className="native-composer-thumb-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveDraftImage(img.id);
                }}
                title="删除图片"
                aria-label="删除图片"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="10"
                  height="10"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  fill="none"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={input}
        rows={1}
        placeholder="询问任何问题，可粘贴或拖入图片"
        onChange={(e) => onInputChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            if (canSend) {
              e.preventDefault();
              onSend();
            }
          }
        }}
      />
      <div className="native-composer-bar">
        {/* 控件组自身占满工具行：权限贴左，模型与推理档位贴右（紧邻发送按钮） */}
        {controls ?? <span style={{ flex: 1 }} />}
        {meter}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAddImages(Array.from(e.target.files));
            }
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="native-composer-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="添加图片"
          aria-label="添加图片"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </button>
        {running && !canSend ? (
          <button className="native-send stop" onClick={onStop} title="停止">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            className="native-send"
            disabled={!canSend}
            onClick={onSend}
            // 运行中有草稿或附件时改为排队发送（与官方一致：同一位置按草稿是否可提交切换）
            title={running ? "排队发送" : "发送"}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 待发送队列：排队中／插话中／发送中，行内可编辑、删除、插话。
 * 条目来自引擎 inbox（agent/inbox/spliced 折出），pending 的是本地乐观回显。
 */
function QueueStrip({
  items,
  running,
  busyId,
  onAction,
}: {
  items: QueuedItem[];
  running: boolean;
  busyId: string | null;
  onAction: (item: QueuedItem, action: QueueAction) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  if (items.length === 0) return null;

  const submitEdit = (item: QueuedItem) => {
    const text = editText.trim();
    if (text) onAction(item, { kind: "edit", content: [{ type: "text", text }] });
    setEditingId(null);
  };

  return (
    <div className="native-queue">
      {items.map((item) => {
        const label = item.pending
          ? "发送中"
          : item.placement === "next-step"
            ? "插话中"
            : "排队中";
        const busy = busyId === item.id;
        const editing = editingId === item.id;
        return (
          <div key={item.id} className="native-queue-row">
            <span className="native-queue-tag">{label}</span>
            {editing ? (
              <textarea
                className="native-queue-edit"
                value={editText}
                rows={2}
                autoFocus
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  } else if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submitEdit(item);
                  }
                }}
              />
            ) : (
              <span className="native-queue-text" title={item.text}>
                {item.images && item.images.length > 0 && (
                  <span className="native-queue-img-tag">
                    [图片{item.images.length > 1 ? ` × ${item.images.length}` : ""}]
                  </span>
                )}
                {item.text}
              </span>
            )}
            <span className="native-queue-actions">
              {editing ? (
                <>
                  <button
                    className="primary"
                    disabled={busy || !editText.trim()}
                    onClick={() => submitEdit(item)}
                  >
                    保存
                  </button>
                  <button onClick={() => setEditingId(null)}>取消</button>
                </>
              ) : (
                <>
                  {item.placement === "next-turn" && running && (
                    <button
                      disabled={busy || item.pending}
                      title="打断当前轮，立刻按这条执行"
                      onClick={() => onAction(item, { kind: "steer" })}
                    >
                      插话
                    </button>
                  )}
                  <button
                    disabled={busy || item.pending}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditText(item.text);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    disabled={busy || item.pending}
                    onClick={() => onAction(item, { kind: "remove" })}
                  >
                    删除
                  </button>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 一道题的暂存答案（skipped 表示用户显式跳过该题，提交空 selected）。 */
interface QuestionDraft {
  selected: string[];
  custom: string;
  skipped?: boolean;
}

/**
 * 识别 plan-review 意图，选举条件与官方同宽：单题、声明意图、detail 存在、
 * approve 指向现有选项 label。不满足时留在通用表单上（意图只改布局，不改可达答案）。
 */
function planReviewOf(
  questions: NonNullable<UserQuestionsRequestPayload["questions"]>,
): { item: (typeof questions)[number]; approve: string } | null {
  if (questions.length !== 1) return null;
  const item = questions[0];
  const approve = item.intent?.kind === "plan-review" ? item.intent.approve : undefined;
  if (!approve || !item.detail) return null;
  if (!(item.options ?? []).some((option) => option.label === approve)) return null;
  return { item, approve };
}

/**
 * 提问卡片：一次只显示一道题（对齐官方 QuestionComposer）。
 *
 * 引擎一次最多带 4 道题，早先「一屏纵向铺开所有题」的写法会把输入区以上整块占满，
 * 题目越多越难看清；官方口径是一题一屏 + 上一题/下一题 + 题号进度，最后一题才提交。
 * 单选点选即翻到下一题（官方同款），多选与自由文本停在原题，随时可翻回去改。
 * plan-review 意图仍走「计划审批」布局：计划用 markdown 滚动展示，决定按钮直接提交。
 */
function QuestionCard({
  request,
  onSubmit,
  onDismiss,
}: {
  request: PendingQuestion;
  onSubmit: (answers: UserQuestionAnswer[]) => Promise<boolean>;
  onDismiss: () => Promise<boolean>;
}) {
  const questions = request.questions ?? [];
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() =>
    questions.map(() => ({ selected: [], custom: "" })),
  );
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const plan = planReviewOf(questions);

  if (questions.length === 0) return null;

  const total = questions.length;
  const at = Math.min(index, total - 1);
  const question = questions[at];
  const multi = question.multiSelect === true;
  const emptyDraft = (): QuestionDraft => ({ selected: [], custom: "" });
  const draftAt = (values: QuestionDraft[], item: number): QuestionDraft =>
    values[item] ?? emptyDraft();
  const draft = draftAt(drafts, at);

  /** 已作答：选中了选项或写了「其他」（跳过是另一条出口，不算作答）。 */
  const answered = (item: QuestionDraft) =>
    item.selected.length > 0 || item.custom.trim() !== "";
  const completed = (item: QuestionDraft) =>
    item.skipped === true || answered(item);
  const completedCount = questions.filter((_, item) =>
    completed(draftAt(drafts, item)),
  ).length;

  /** 整组答案：跳过题回空 selected，单选填了「其他」就以自由文本为准。 */
  const buildAnswers = (values: QuestionDraft[]): UserQuestionAnswer[] =>
    questions.map((q, item) => {
      const value = draftAt(values, item);
      const custom = value.custom.trim();
      return {
        id: q.id,
        selected:
          value.skipped || (custom && q.multiSelect !== true)
            ? []
            : value.selected,
        ...(custom ? { custom } : {}),
      };
    });

  const dismiss = async () => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await onDismiss();
    if (!ok) setSubmitting(false);
  };

  /** 提交整组答案：仍有未作答且未跳过的题时跳到那一题并提示（官方口径）。 */
  const submit = async (values: QuestionDraft[]) => {
    if (submitting) return;
    const missing = questions.findIndex(
      (_, item) => !completed(draftAt(values, item)),
    );
    if (missing >= 0) {
      setIndex(missing);
      setError(`请先完成第 ${missing + 1} 题`);
      return;
    }
    setSubmitting(true);
    const ok = await onSubmit(buildAnswers(values));
    if (!ok) setSubmitting(false);
  };

  /** 改写当前题的暂存答案；nextIndex 用于单选题「选中即翻页」。 */
  const updateDraft = (
    update: (current: QuestionDraft) => QuestionDraft,
    nextIndex = at,
  ) => {
    setDrafts((prev) =>
      questions.map((_, item) =>
        item === at ? update(draftAt(prev, item)) : draftAt(prev, item),
      ),
    );
    setIndex(nextIndex);
    setError(null);
  };

  const choose = (label: string) => {
    updateDraft(
      (item) =>
        multi
          ? {
              ...item,
              selected: item.selected.includes(label)
                ? item.selected.filter((entry) => entry !== label)
                : [...item.selected, label],
              skipped: false,
            }
          : // 单选题：选中选项与自定义答案互斥
            { selected: [label], custom: "", skipped: false },
      // 单选点选即翻到下一题，最后一题留在原地等提交
      !multi && at < total - 1 ? at + 1 : at,
    );
  };

  const setCustom = (value: string) => {
    updateDraft((item) => ({
      ...item,
      custom: value,
      selected: multi ? item.selected : [],
      skipped: false,
    }));
  };

  /** 跳过当前题：该题回空 selected；已到最后一题则整组提交。 */
  const skipQuestion = () => {
    const next = questions.map((_, item) =>
      item === at
        ? { selected: [], custom: "", skipped: true }
        : draftAt(drafts, item),
    );
    setDrafts(next);
    setError(null);
    if (at < total - 1) {
      setIndex(at + 1);
      return;
    }
    void submit(next);
  };

  /** 下一题：当前题须已作答（跳过是显式出口）；最后一题直接提交。 */
  const continueFlow = () => {
    if (!answered(draft)) {
      setError("请先选择一个选项、填写「其他」，或点「跳过本题」");
      return;
    }
    if (at < total - 1) {
      setIndex(at + 1);
      setError(null);
      return;
    }
    void submit(drafts);
  };

  // plan-review：计划作为可滚动 markdown，决定按钮直接提交（官方口径：其余选项即拒绝）
  if (plan) {
    const others = (plan.item.options ?? []).filter(
      (option) => option.label !== plan.approve,
    );
    /** 计划审批不走逐题暂存，按钮即整组答案（单题请求）。 */
    const decide = async (label: string) => {
      if (submitting) return;
      setSubmitting(true);
      const ok = await onSubmit([{ id: plan.item.id, selected: [label] }]);
      if (!ok) setSubmitting(false);
    };
    return (
      <div className="native-card question">
        <div className="native-card-strip">计划审批</div>
        {plan.item.header && (
          <div className="native-question-header">{plan.item.header}</div>
        )}
        <div className="native-question-title">{plan.item.question}</div>
        <div className="native-plan">
          <Markdown text={plan.item.detail ?? ""} />
        </div>
        <div className="native-card-actions">
          <button
            className="primary"
            disabled={submitting}
            onClick={() => void decide(plan.approve)}
          >
            {plan.approve}
          </button>
          {others.map((option) => (
            <button
              key={option.label}
              disabled={submitting}
              title={option.description}
              onClick={() => void decide(option.label)}
            >
              {option.label}
            </button>
          ))}
          <span className="native-question-spacer" />
          <button
            className="native-question-dismiss"
            disabled={submitting}
            title="不选任何选项，直接说出你的想法"
            onClick={() => void dismiss()}
          >
            讨论一下
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="native-card question">
      <div className="native-question" key={question.id}>
        <div className="native-question-head">
          {question.header && (
            <div className="native-question-header">{question.header}</div>
          )}
          {total > 1 && (
            <div className="native-question-progress">
              第 {at + 1} / {total} 题
            </div>
          )}
        </div>
        <div className="native-question-title">{question.question}</div>
        {question.detail && (
          <div className="native-question-detail">{question.detail}</div>
        )}
        {(question.options ?? []).length > 0 && (
          <div className="native-options" role={multi ? "group" : "radiogroup"}>
            {(question.options ?? []).map((option) => {
              const active = draft.selected.includes(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`native-option${active ? " selected" : ""}`}
                  aria-pressed={active}
                  disabled={submitting}
                  onClick={() => choose(option.label)}
                >
                  <span className={`native-option-mark${multi ? " multi" : ""}`}>
                    {active ? "✓" : ""}
                  </span>
                  <span className="native-option-body">
                    <span className="native-option-label">{option.label}</span>
                    {option.description && (
                      <span className="native-option-desc">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <input
          className="native-question-custom"
          value={draft.custom}
          disabled={submitting}
          placeholder={multi ? "其他（可与上面同时选）" : "其他（自行输入）"}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            continueFlow();
          }}
        />
        <div className="native-question-footnote">
          <button
            type="button"
            className="native-question-skip"
            disabled={submitting}
            onClick={skipQuestion}
          >
            {draft.skipped ? "已跳过" : "跳过本题"}
          </button>
          {multi && <span className="native-question-hint">可多选</span>}
        </div>
      </div>
      <div className="native-card-actions native-question-submit">
        {error ? (
          <span className="native-question-error">{error}</span>
        ) : (
          total > 1 && (
            <span className="native-question-hint">
              已填 {completedCount} / {total}
            </span>
          )
        )}
        {total > 1 && (
          <button
            type="button"
            disabled={submitting || at === 0}
            onClick={() => {
              setIndex(at - 1);
              setError(null);
            }}
          >
            上一题
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={submitting}
          onClick={continueFlow}
        >
          {submitting ? "提交中…" : at < total - 1 ? "下一题" : "提交"}
        </button>
        <span className="native-question-spacer" />
        <button
          type="button"
          className="native-question-dismiss"
          disabled={submitting}
          title="放弃整组问题，改为直接说出你的想法"
          onClick={() => void dismiss()}
        >
          放弃整组问题
        </button>
      </div>
    </div>
  );
}

/** 权限预设值的中文展示（未知值原样展示）。 */
const PERMISSION_LABELS: Record<string, string> = {
  "read-only": "仅可查看",
  "workspace-write": "工作区内修改",
  "danger-full-access": "完全权限",
  custom: "自定义",
};

/** 推理强度档位的中文展示（未知档位回退目录提供的 name）。 */
const EFFORT_LABELS: Record<string, string> = {
  off: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  max: "最高",
};

function permissionLabel(value: string): string {
  return PERMISSION_LABELS[value] ?? value;
}

/**
 * 从 permission 命名空间的 schemastery 序列化 schema 解析 defaultPreset 可选档位。
 * 官方设置行用 nodeAtPath(rehydrate(schema)) 取该 union 的 const 列表，这里直接走
 * 序列化形态（refs 引用表 + dict/list 索引），结构不符预期时返回空数组。
 */
function permissionPresetsFromSchema(schema: unknown): PresetOption[] {
  try {
    const root = schema as {
      uid?: number;
      refs?: Record<string, unknown>;
      dict?: Record<string, unknown>;
    } | null;
    const refs = root?.refs;
    if (!root || !refs) return [];
    const resolve = (node: unknown): Record<string, unknown> | null => {
      const raw = typeof node === "number" ? refs[String(node)] : node;
      return typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : null;
    };
    const holder = [root, ...Object.values(refs)].find((node) => {
      const dict = (node as { dict?: Record<string, unknown> } | null)?.dict;
      return dict !== undefined && "defaultPreset" in dict;
    }) as { dict: Record<string, unknown> } | undefined;
    const union = holder ? resolve(holder.dict.defaultPreset) : null;
    if (!union || !Array.isArray(union.list)) return [];
    const options: PresetOption[] = [];
    for (const entry of union.list) {
      const node = resolve(entry);
      if (node && node.type === "const" && typeof node.value === "string") {
        options.push({ value: node.value, name: node.value });
      }
    }
    return options;
  } catch {
    return [];
  }
}

interface ComposerControlsProps {
  catalog: ModelCatalog | null;
  selection: ModelSelection | null;
  /** 权限选择；空态传新会话默认权限，无权限服务时传 null 隐藏控件。 */
  permission: PermissionSelect | null;
  /** 控件标题补充（空态标明"新会话默认权限"）。 */
  permissionHint?: string;
  onModelPick: (selection: ModelSelection) => void;
  onEffortPick: (effortId: string) => void;
  onPermissionPick: (value: string) => void;
}

/** 输入框工具行：权限选择器贴左，模型与推理强度两个下拉贴右（弹出层单开，点击外部关闭）。 */
function ComposerControls({
  catalog,
  selection,
  permission,
  permissionHint,
  onModelPick,
  onEffortPick,
  onPermissionPick,
}: ComposerControlsProps) {
  const [open, setOpen] = useState<
    "model" | "effort" | "permission" | null
  >(null);
  /** danger-full-access 的风险确认态（对齐官方确认交互）。 */
  const [confirmDanger, setConfirmDanger] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const model = useMemo(() => {
    if (!catalog || !selection) return null;
    return (
      catalog.groups
        .find((g) => g.id === selection.provider)
        ?.models.find((m) => m.id === selection.model) ?? null
    );
  }, [catalog, selection]);
  const efforts = model?.reasoning?.efforts?.length
    ? model.reasoning.efforts
    : null;
  const effortId =
    selection?.reasoningEffort ?? model?.reasoning?.defaultEffort;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
        setConfirmDanger(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 权限与模型目录相互独立：任一可用即渲染控件组
  if (!selection && !permission) return null;

  const toggle = (menu: "model" | "effort" | "permission") => {
    setOpen((prev) => (prev === menu ? null : menu));
    setConfirmDanger(false);
  };

  /** 模型 pill 文案：只呈现模型名；当前思考档位由相邻的推理强度 pill 常显。 */
  const modelPillText = model?.name ?? selection?.model ?? "选择模型";

  return (
    <div className="native-composer-controls" ref={rootRef}>
      {permission && (
        <div className="native-picker">
          <button
            className={`native-pill${open === "permission" ? " active" : ""}`}
            onClick={() => toggle("permission")}
            title={permissionHint ?? "权限模式"}
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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            </svg>
            <span className="native-pill-text">
              {permissionLabel(permission.currentValue)}
            </span>
            <svg
              className="native-pill-chevron"
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
          {open === "permission" && (
            <div className="native-popover">
              {permission.options.map((option) => (
                <button
                  key={option.value}
                  className={`native-popover-item${permission.currentValue === option.value ? " active" : ""}`}
                  onClick={() => {
                    if (
                      option.value === "danger-full-access" &&
                      !confirmDanger
                    ) {
                      setConfirmDanger(true);
                      return;
                    }
                    onPermissionPick(option.value);
                    setOpen(null);
                    setConfirmDanger(false);
                  }}
                  title={option.description}
                >
                  <span className="native-popover-item-name">
                    {permissionLabel(option.value)}
                  </span>
                </button>
              ))}
              {confirmDanger && (
                <div className="native-popover-confirm">
                  <div className="native-popover-confirm-text">
                    启用完全权限后将减少确认步骤，可直接执行敏感操作、文件修改或外部命令。仅建议在信任后续任务时使用。
                  </div>
                  <div className="native-popover-confirm-actions">
                    <button
                      className="native-popover-confirm-cancel"
                      onClick={() => {
                        setConfirmDanger(false);
                        setOpen(null);
                      }}
                    >
                      取消
                    </button>
                    <button
                      className="native-popover-confirm-go"
                      onClick={() => {
                        onPermissionPick("danger-full-access");
                        setOpen(null);
                        setConfirmDanger(false);
                      }}
                    >
                      我已了解风险，启用
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <span className="native-composer-controls-spacer" />

      <div className="native-picker native-picker-end">
        <button
          className={`native-pill${open === "model" ? " active" : ""}`}
          onClick={() => toggle("model")}
          title="选择模型"
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
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
          </svg>
          <span className="native-pill-text">{modelPillText}</span>
          <svg
            className="native-pill-chevron"
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
        {open === "model" && (
          <div className="native-popover">
            {catalog ? (
              catalog.groups.map((group) => (
                <div key={group.id} className="native-popover-group">
                  <div className="native-popover-group-title">{group.name}</div>
                  {group.models.map((m) => (
                    <button
                      key={m.id}
                      className={`native-popover-item${
                        selection?.provider === group.id &&
                        selection?.model === m.id
                          ? " active"
                          : ""
                      }`}
                      onClick={() => {
                        onModelPick({ provider: group.id, model: m.id });
                        setOpen(null);
                      }}
                      title={m.description}
                    >
                      <span className="native-popover-item-name">{m.name}</span>
                      {m.description && (
                        <span className="native-popover-item-desc">
                          {m.description}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="native-popover-empty">模型目录不可用</div>
            )}
          </div>
        )}
      </div>

      {efforts && (
        <div className="native-picker native-picker-end">
          <button
            className={`native-pill${open === "effort" ? " active" : ""}`}
            onClick={() => toggle("effort")}
            title="推理强度"
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
              <path d="M12 3a6 6 0 0 0 0 12c0 2 0 3-2 4 1-2 0-2 2-2a6 6 0 0 0 0-12Z" />
            </svg>
            <span className="native-pill-text">
              {effortId ? (EFFORT_LABELS[effortId] ?? effortId) : "默认"}
            </span>
            <svg
              className="native-pill-chevron"
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
          {open === "effort" && (
            <div className="native-popover">
              {efforts.map((effort) => (
                <button
                  key={effort.id}
                  className={`native-popover-item${effortId === effort.id ? " active" : ""}`}
                  onClick={() => {
                    onEffortPick(effort.id);
                    setOpen(null);
                  }}
                  title={effort.description}
                >
                  <span className="native-popover-item-name">
                    {EFFORT_LABELS[effort.id] ?? effort.name}
                  </span>
                  {effort.description && (
                    <span className="native-popover-item-desc">
                      {effort.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 待处理项的呈现类别（决定同一会话内的优先级与侧栏提示文案）。 */
type PendingKind = "approval" | "question" | "plan-review";

/** 待决策审批（$events 瀑布）。 */
interface PendingApproval extends ApprovalRequestPayload {
  eventId: string;
  clientId: string;
  /**
   * 归属会话 id：瀑布帧的 agentId。引擎里 Agent id 恒等于 Session id，
   * 所以待处理项天然属于发起它的那个会话。
   */
  sessionId: string;
}

/** 待回答问答（$events 瀑布）。 */
interface PendingQuestion extends UserQuestionsRequestPayload {
  eventId: string;
  clientId: string;
  sessionId: string;
}

/**
 * 归拢后的一条待处理项：类别 + 原载荷 + 归属会话（已解到根会话）。
 * 同一会话内多条等待的优先级顺序与官方一致（计划审批 > 提问 > 授权）。
 */
type PendingEntry =
  | { kind: "approval"; approval: PendingApproval; owner: string }
  | { kind: "question" | "plan-review"; question: PendingQuestion; owner: string };

/** 同一会话里只展示一条待处理项；多条并存时按此优先级取最高的那条。 */
const PENDING_PRECEDENCE: Record<PendingKind, number> = {
  approval: 0,
  question: 1,
  "plan-review": 2,
};

/** 侧栏会话行的等待提示（对齐官方 status.waitingApproval 等口径）。 */
const PENDING_LABELS: Record<PendingKind, string> = {
  approval: "等待授权",
  question: "等待回答",
  "plan-review": "计划待审",
};

/**
 * 待处理项的所属会话：子代理会话的待处理项归到它的根会话。
 *
 * 青梧界面不展示子代理会话（见 visibleSessions），子代理请求审批时若按子会话
 * 归位，那张卡片在界面上就没有任何入口可答，宿主会一直挂着等。会话不在列表里
 * （已删除、帧缺 agentId）时原样返回，由调用方决定兜底。
 */
function ownerSessionOf(
  sessionId: string,
  byId: Map<string, SessionSummary>,
): string {
  let current = sessionId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current)?.parentSessionId;
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** 会话行的状态标记：等待回答/授权优先于「运行中」，再次为「未查看完成」。 */
function SessionStatusMark({
  running,
  pending,
  unread,
}: {
  running: boolean;
  pending: PendingKind | null;
  unread?: boolean;
}) {
  if (pending) {
    return (
      <span
        className="native-status-mark native-waiting-dot"
        title={PENDING_LABELS[pending]}
      />
    );
  }
  if (running) {
    return (
      <span
        className="native-status-mark native-running-dot"
        title="任务进行中"
      />
    );
  }
  if (unread) {
    return (
      <span
        className="native-status-mark native-unread-dot"
        title="任务已完成，未查看"
      />
    );
  }
  return null;
}

/**
 * 侧栏会话行：左侧状态指示（进行中/等待中/未查看） + 会话标题；
 * 悬停浮现「···」操作菜单（置顶 / 重命名 / 归档）；
 * 支持 indented 缩进（从属于项目分组时使用）。
 */
function SessionRow({
  title,
  tooltip,
  active,
  pinned,
  running,
  pending,
  unread,
  indented,
  onClick,
  onTogglePin,
  onRename,
  onArchive,
}: {
  title: string;
  tooltip?: string;
  active: boolean;
  pinned: boolean;
  running?: boolean;
  pending: PendingKind | null;
  unread?: boolean;
  indented?: boolean;
  onClick: () => void;
  onTogglePin?: () => void;
  onRename?: (title: string) => void;
  onArchive?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!renaming) setDraftTitle(title);
  }, [title, renaming]);

  const commitRename = () => {
    const next = draftTitle.trim();
    setRenaming(false);
    if (next && next !== title && onRename) onRename(next);
    else setDraftTitle(title);
  };

  return (
    <div
      className={`native-session-row${active ? " active" : ""}${indented ? " indented" : ""}`}
      ref={rootRef}
    >
      {renaming ? (
        <input
          className="native-session-rename"
          value={draftTitle}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
            if (e.key === "Escape") {
              setDraftTitle(title);
              setRenaming(false);
            }
          }}
          onBlur={commitRename}
          aria-label="会话名称"
        />
      ) : (
        <>
          <button
            className="native-session-main"
            onClick={onClick}
            title={tooltip}
          >
            {/* 状态小圆点位于会话标题左侧 */}
            <SessionStatusMark
              running={Boolean(running)}
              pending={pending}
              unread={unread}
            />
            <span className="native-session-title">{title}</span>
          </button>
          <button
            className={`native-session-act${menuOpen ? " visible" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="会话操作"
            aria-label={`会话“${title}”的操作`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          {menuOpen && (
            <div className="native-session-menu">
              {onTogglePin && (
                <button
                  className="native-popover-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onTogglePin();
                  }}
                >
                  <span className="native-popover-item-name">
                    {pinned ? "取消置顶" : "置顶会话"}
                  </span>
                </button>
              )}
              {onRename && (
                <button
                  className="native-popover-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                >
                  <span className="native-popover-item-name">重命名</span>
                </button>
              )}
              {onArchive && (
                <button
                  className="native-popover-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onArchive();
                  }}
                >
                  <span className="native-popover-item-name">归档会话</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 会话内渲染条目。 */
type ChatItem =
  | {
      kind: "user";
      key: string;
      text: string;
      images?: MessageImageItem[];
      time: number;
    }
  | {
      kind: "assistant";
      key: string;
      text: string;
      reasoning: string;
      interrupted?: boolean;
      /** 该 assistant/message 事件时间。 */
      time: number;
      /** 最近一条 user 消息时间（无则 null），用于计算用时。 */
      startTime: number | null;
    }
  | { kind: "tool"; key: string; tool: ToolItem };

/**
 * 带轮次归属的渲染条目。
 *
 * turn 是该条目的引擎轮次（日志里 turn/start、assistant/message、tool/call 都带），
 * tier 标出它在一轮里的位置：
 * - answer：这一轮的正式回答，永远直接显示；
 * - context：回答之前的思考与执行过程（思考块、工具卡片、中间消息），
 *   轮次结束后收进「已思考 · N 次工具调用」折叠行；
 * - 未标记：正在跑的轮次里的条目，一律直接显示，不做折叠。
 */
type MarkedChatItem = ChatItem & {
  turn: number;
  tier?: "answer" | "context";
};

/** 一轮的聚合视图：轮内条目 + 该轮是否收束 + 折叠行计数。 */
interface TurnView {
  turn: number;
  items: MarkedChatItem[];
  /** 这一轮的正式回答（无则 null：运行中的轮次、或整轮只有过程没有答复）。 */
  answer: MarkedChatItem | null;
  /** 回答之前的过程条目。 */
  context: MarkedChatItem[];
  toolCount: number;
  messageCount: number;
  /** 轮次已收束、有答复、且过程里有内容：这一轮以过程折叠行呈现。 */
  foldable: boolean;
  /** 回答条目的 key（据它把 answer 从 items 里取出来）。 */
  answerKey: string | null;
}

/**
 * 把条目按轮次聚合，并算出每轮的过程折叠视图。
 *
 * 折叠只在轮次收束（收到 turn/end）后启用：尚未收束的轮次照旧逐条显示，
 * 过程条目在「回答之前」才是过程，回答之后的条目（异常收尾的补充消息）
 * 照旧直接显示，不会被吞掉。
 */
function groupTurns(
  items: MarkedChatItem[],
  endedTurns: Set<number>,
): TurnView[] {
  const turns: TurnView[] = [];
  const indexByTurn = new Map<number, number>();
  for (const item of items) {
    let index = indexByTurn.get(item.turn);
    if (index === undefined) {
      index = turns.length;
      indexByTurn.set(item.turn, index);
      turns.push({
        turn: item.turn,
        items: [],
        answer: null,
        context: [],
        toolCount: 0,
        messageCount: 0,
        foldable: false,
        answerKey: null,
      });
    }
    const view = turns[index];
    view.items.push(item);
    if (item.tier === "answer") {
      view.answerKey = item.key;
    } else if (item.tier === "context") {
      view.context.push(item);
      if (item.kind === "tool") view.toolCount += 1;
      else if (item.kind === "assistant") view.messageCount += 1;
    }
  }
  for (const view of turns) {
    if (view.answerKey === null) continue;
    view.answer = view.items.find((item) => item.key === view.answerKey) ?? null;
    if (!endedTurns.has(view.turn)) continue;
    // 过程里没有可收的东西（例如整轮只有工具卡片）：不收，避免折叠行点开是空的
    view.foldable =
      view.context.length > 0 ||
      Boolean(view.answer && view.answer.kind === "assistant" && view.answer.reasoning);
  }
  return turns;
}

function foldChatItems(events: SessionEvent[]): TurnView[] {
  const tools = new Map<string, ToolItem>();
  const items: MarkedChatItem[] = [];
  /** 已经收到 turn/end 的轮次：只有这些轮次收进折叠行。 */
  const endedTurns = new Set<number>();
  let lastUserTime: number | null = null;
  /** 当前事件所属轮次：优先 turn/start 声明，其次沿用上一条已知轮次。 */
  let turn = 0;

  for (const event of events) {
    if (event.type === "turn/start") {
      const data = event.data as { turn?: number } | null;
      if (typeof data?.turn === "number") turn = data.turn;
      continue;
    }
    if (event.type === "turn/end") {
      const data = event.data as { turn?: number } | null;
      if (typeof data?.turn === "number") endedTurns.add(data.turn);
      continue;
    }
    if (event.type === "user/message") {
      const data = event.data as {
        source?: { kind: string };
        content?: unknown[];
      } | null;
      if (data?.source?.kind === "user" && Array.isArray(data.content)) {
        const eventTurn = (event.data as { turn?: number } | null)?.turn;
        if (typeof eventTurn === "number") turn = eventTurn;
        lastUserTime = event.time;
        const images: MessageImageItem[] = [];
        for (const block of data.content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as { type: unknown }).type === "image"
          ) {
            const att = (block as { attachment?: ImageAttachmentRef }).attachment;
            if (att && typeof att.attachmentId === "string") {
              images.push({
                attachmentId: att.attachmentId,
                mediaType: att.mediaType,
                name: att.name,
                width: att.width,
                height: att.height,
              });
            }
          }
        }
        items.push({
          kind: "user",
          key: `u-${event.seq}`,
          text: textOf(data.content, "text"),
          images: images.length > 0 ? images : undefined,
          time: event.time,
          turn,
        });
      }
    } else if (event.type === "assistant/message") {
      const data = event.data as AssistantMessageData | null;
      if (typeof data?.turn === "number") turn = data.turn;
      const content = data?.message?.content;
      items.push({
        kind: "assistant",
        key: `a-${event.seq}`,
        text: content ? textOf(content, "text") : "",
        reasoning: content ? textOf(content, "reasoning") : "",
        interrupted: data?.interrupted,
        time: event.time,
        startTime: lastUserTime,
        turn,
      });
    } else if (event.type === "tool/call") {
      const data = event.data as ToolCallEventData;
      if (typeof data.turn === "number") turn = data.turn;
      const item: ToolItem = {
        callId: data.callId,
        name: data.name,
        arguments: data.arguments,
        pending: true,
        callTime: event.time,
      };
      tools.set(data.callId, item);
      items.push({ kind: "tool", key: `t-${event.seq}`, tool: item, turn });
    } else if (event.type === "tool/result") {
      const data = event.data as ToolResultEventData;
      const block = data.message?.content?.[0];
      if (block && block.type === "tool-result") {
        const target = tools.get(block.toolCallId);
        const resultText = Array.isArray(block.content)
          ? textOf(block.content as unknown[], "text")
          : "";
        if (target) {
          target.pending = false;
          target.resultTime = event.time;
          target.resultText =
            resultText ||
            (data.error ? `${data.error.name}: ${data.error.code}` : "");
          target.isError = Boolean(data.error) || Boolean(block.isError);
        } else {
          items.push({
            kind: "tool",
            key: `t-${event.seq}`,
            tool: {
              callId: block.toolCallId,
              name: "tool",
              arguments: "",
              resultText,
              isError: Boolean(block.isError),
              pending: false,
              resultTime: event.time,
            },
            turn,
          });
        }
      }
    }
  }

  // 一轮里最后一条有正文的助手消息就是这一轮的答复；它之前的条目都是过程。
  // 只有已经收到 turn/end 的轮次才收：正在跑的轮次中途也可能已经有一条答复，
  // 那时收起来会把后面还在跑的过程挡在外面（且运行中用户正要看过程）。
  const marked = groupTurns(items, endedTurns);
  for (const view of marked) {
    if (!view.foldable) continue;
    let answerIndex = -1;
    for (let index = view.items.length - 1; index >= 0; index -= 1) {
      const item = view.items[index];
      if (item.kind === "assistant" && item.text.trim() !== "") {
        answerIndex = index;
        break;
      }
    }
    if (answerIndex < 0) continue;
    view.items.forEach((item, index) => {
      if (index === answerIndex) item.tier = "answer";
      else if (index < answerIndex) item.tier = "context";
    });
  }

  return groupTurns(items, endedTurns);
}

/**
 * 待发送条目：来自引擎 inbox（next-turn = 排队中，next-step = 插话中），
 * 或来自本地乐观回显（pending，尚未被宿主确认）。
 */
interface QueuedItem {
  /** 引擎消息 id（session/updateQueue 用它寻址）；回显为本地 id。 */
  id: string;
  /** 本机提交时铸的 requestId，用于回显退休。 */
  rpcId?: string;
  placement: "next-turn" | "next-step";
  text: string;
  images?: MessageImageItem[];
  pending?: boolean;
}

/**
 * 从日志事件折出当前待发送队列。
 *
 * inbox 变更以 durable 事件 `agent/inbox/spliced` 记录（target/start/removedCount/inserted），
 * 因此无需额外订阅控制流即可在切换会话、重连后重建队列。
 * 只保留人提交的消息（source.kind === 'user'），跳过插件注入的上下文消息。
 */
function foldQueue(events: SessionEvent[]): {
  queue: QueuedItem[];
  rpcIds: Set<string>;
} {
  const lists: Record<"next-turn" | "next-step", InboxMessage[]> = {
    "next-turn": [],
    "next-step": [],
  };
  for (const event of events) {
    if (event.type !== "agent/inbox/spliced") continue;
    const data = event.data as InboxSplicedEventData | null;
    if (!data || (data.target !== "next-turn" && data.target !== "next-step")) {
      continue;
    }
    const list = lists[data.target];
    const start = Math.min(Math.max(Number(data.start) || 0, 0), list.length);
    const removed = Math.max(Number(data.removedCount) || 0, 0);
    const inserted = Array.isArray(data.inserted) ? data.inserted : [];
    list.splice(start, Math.min(removed, list.length - start), ...inserted);
  }

  const queue: QueuedItem[] = [];
  const rpcIds = new Set<string>();
  for (const placement of ["next-turn", "next-step"] as const) {
    for (const message of lists[placement]) {
      if (message.source?.kind !== "user") continue;
      const rpcId = message.source.rpcId;
      if (typeof rpcId === "string") rpcIds.add(rpcId);
      const images: MessageImageItem[] = [];
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as { type: unknown }).type === "image"
          ) {
            const att = (block as { attachment?: ImageAttachmentRef }).attachment;
            if (att && typeof att.attachmentId === "string") {
              images.push({
                attachmentId: att.attachmentId,
                mediaType: att.mediaType,
                name: att.name,
                width: att.width,
                height: att.height,
              });
            }
          }
        }
      }
      queue.push({
        id: message.id ?? `${placement}-${queue.length}`,
        rpcId: typeof rpcId === "string" ? rpcId : undefined,
        placement,
        text: textOf(message.content ?? [], "text"),
        images: images.length > 0 ? images : undefined,
      });
    }
  }
  return { queue, rpcIds };
}

/** 日志里已经落库的用户消息所携带的 requestId（回显退休用）。 */
function foldUserRpcIds(events: SessionEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== "user/message") continue;
    const data = event.data as { source?: { rpcId?: string } } | null;
    const rpcId = data?.source?.rpcId;
    if (typeof rpcId === "string") ids.add(rpcId);
  }
  return ids;
}

/**
 * 合并一条工作区 upsert，顺序保持不动：已在列表里的就地替换（会话归属、标题变化
 * 不改变它在侧栏的位置），新工作区插到最前——与宿主「新建工作区前插」的落点一致。
 */
function upsertWorkspace(
  prev: WorkspaceView[],
  workspace: WorkspaceView,
): WorkspaceView[] {
  const index = prev.findIndex((w) => w.workspaceId === workspace.workspaceId);
  if (index < 0) return [workspace, ...prev];
  const next = [...prev];
  next[index] = workspace;
  return next;
}

/**
 * 应用宿主登记的权威顺序（order 帧）：按它重排已知工作区，未在名单内的保留在
 * 原位、名单里尚未下发到本端的 id 自然略过，避免因为一次不完整的名单丢条目。
 */
function orderWorkspaces(
  prev: WorkspaceView[],
  workspaceIds: string[],
): WorkspaceView[] {
  const rank = new Map(workspaceIds.map((id, index) => [id, index]));
  return [...prev].sort((a, b) => {
    const left = rank.get(a.workspaceId);
    const right = rank.get(b.workspaceId);
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });
}

export function NativeApp({
  sidebarCollapsed,
}: {
  /** 侧栏折叠态（开关在标题栏菜单栏，状态由入口层持有，与 TitleBar 共用）。 */
  sidebarCollapsed: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  /** 会话列表最新快照：切换会话时据它播种运行态，避免把 sessions 纳入 effect 依赖。 */
  const sessionsRef = useRef<SessionSummary[]>([]);
  sessionsRef.current = sessions;
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  /** 宿主全量已归档会话集合：列表与分组必须主动排除，解归档前不显示。 */
  const [archivedSessionIds, setArchivedSessionIds] = useState<string[]>([]);
  /** 侧栏置顶数据（本地持久化）。 */
  const [pinnedData, setPinnedData] = useState<PinnedData>(loadPinnedData);
  /** 后台执行完成但用户尚未查看的会话集合（左侧蓝点提醒）。 */
  const [unreadFinishedSessionIds, setUnreadFinishedSessionIds] = useState<
    Set<string>
  >(new Set());

  const toggleWorkspacePin = useCallback((workspaceId: string) => {
    setPinnedData((prev) => {
      const exists = prev.workspaces.includes(workspaceId);
      const nextWorkspaces = exists
        ? prev.workspaces.filter((id) => id !== workspaceId)
        : [workspaceId, ...prev.workspaces];
      const next = { ...prev, workspaces: nextWorkspaces };
      savePinnedData(next);
      return next;
    });
  }, []);

  const toggleSessionPin = useCallback((sessionId: string) => {
    setPinnedData((prev) => {
      const exists = prev.sessions.includes(sessionId);
      const nextSessions = exists
        ? prev.sessions.filter((id) => id !== sessionId)
        : [sessionId, ...prev.sessions];
      const next = { ...prev, sessions: nextSessions };
      savePinnedData(next);
      return next;
    });
  }, []);
  /** 最近活跃工作区（对齐官方 New Session 语义：新会话落在这里）。 */
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [items, setItems] = useState<TurnView[]>([]);
  const [draft, setDraft] = useState("");
  /** 流式思考文本（reasoning-delta 累积）。 */
  const [liveReasoning, setLiveReasoning] = useState("");
  /**
   * 在飞块是否仍是思考块：思考增量置真，文本/工具调用块开始后置假。只决定
   * 折叠行的摘取哪一行、要不要扫光（对齐官方「推理块是否仍是流式尾巴」的判据）。
   */
  const [reasoningActive, setReasoningActive] = useState(false);
  /** block-start(tool-call) 已宣告但 tool/call 事件未落地的提示态。 */
  const [toolCalling, setToolCalling] = useState(false);
  const [input, setInput] = useState("");
  /**
   * 逐会话草稿（仅内存，重启不保留）：键为会话 id，无会话时用空串。
   * 切换会话时切走保留、切回恢复，避免把 A 里没写完的半句话发到 B。
   */
  const composerDraftsRef = useRef<Map<string, string>>(new Map());
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const composerImagesRef = useRef<Map<string, DraftImage[]>>(new Map());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** 引擎 inbox 里的待发送队列（排队中／插话中），由 agent/inbox/spliced 折出。 */
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  /** 本地乐观回显：提交当帧即显示，宿主落库或入队后退休。 */
  const [echoes, setEchoes] = useState<QueuedItem[]>([]);
  /** 正在处理的队列操作条目 id（按钮禁用态）。 */
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /** 右侧面板折叠态（默认收起，需要时再展开）。 */
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  /** 会话搜索（纯前端标题过滤）。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  /** 侧栏折叠的分组标题集合。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  /** 模型目录（provider 分组 + 默认选择），拉取失败仅降级选择器。 */
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  /** 空态（尚未建会话）待应用的模型选择，发送时随会话创建写入。 */
  const [emptySelection, setEmptySelection] = useState<ModelSelection | null>(
    null,
  );
  /** 新会话默认权限（settings permission 命名空间 defaultPreset），空态选择器读写的对象。 */
  const [defaultPermission, setDefaultPermission] = useState<
    (PermissionSelect & { writable: boolean; revision: number }) | null
  >(null);
  /** 左右面板宽度（拖拽调节，localStorage 记忆，双击复位）。 */
  const sidebarPanel = usePanelWidth({
    storageKey: "qingwu.native.sidebarWidth",
    defaultWidth: 232,
    min: 180,
    max: 400,
  });
  const rightPanel = usePanelWidth({
    storageKey: "qingwu.native.panelWidth",
    defaultWidth: 300,
    min: 220,
    max: 480,
  });
  const eventsRef = useRef<SessionEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickBottomRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);
  const sessionStreamRef = useRef<string | null>(null);
  const eventsClientIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | undefined>(undefined);

  const refreshSessions = useCallback(async () => {
    try {
      const listValue = await rpc<{ items: SessionSummary[] }>(
        Endpoints.sessionList,
        {
          _request: {},
        },
      );
      setSessions(listValue.items);
      // 运行态以列表兜底对账：引擎的 api-session/status 只在 running↔idle
      // 跳变时发出，切换会话与断线重连都不会重放，光靠事件会长期停在旧值。
      const current = listValue.items.find(
        (entry) => entry.sessionId === currentIdRef.current,
      );
      if (current) setRunning(current.running);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== undefined)
      window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(
      () => void refreshSessions(),
      300,
    );
  }, [refreshSessions]);

  /** 用当前事件窗口重算对话、队列与回显退休（快照与增量共用一条路径）。 */
  const refreshFromEvents = useCallback(() => {
    setItems(foldChatItems(eventsRef.current));
    const folded = foldQueue(eventsRef.current);
    setQueue(folded.queue);
    // 回显退休：宿主已把这条提交落成 durable user/message 或队列项
    const settled = new Set([...folded.rpcIds, ...foldUserRpcIds(eventsRef.current)]);
    setEchoes((prev) => {
      const kept = prev.filter(
        (echo) => !echo.rpcId || !settled.has(echo.rpcId),
      );
      return kept.length === prev.length ? prev : kept;
    });
  }, []);

  const appendEvent = useCallback(
    (event: SessionEvent) => {
      eventsRef.current = [...eventsRef.current, event];
      if (event.type === "tool/call") setToolCalling(false);
      // 上下文占用/用量随这些事件变化。官方是客户端自己折投影，我们直接复用宿主
      // 算好的投影列，所以要在这些事件到达时重取一次会话列表。
      if (movesContextMeter(event.type)) scheduleRefresh();
      refreshFromEvents();
    },
    [refreshFromEvents, scheduleRefresh],
  );

  // 初始化：界面模式 + 会话列表；无活跃工作区时默认取第一个
  useEffect(() => {
    void qingwu
      .getUiMode()
      .then((mode: UiMode) => setVisible(mode === "native"));
    void refreshSessions();
    return qingwu.onUiModeChanged((mode) => setVisible(mode === "native"));
  }, [refreshSessions]);

  // 青梧界面激活时给 body 添加标记类（控制标题栏样式对齐等）
  useEffect(() => {
    const body = document.body;
    if (visible) {
      body.classList.add("native-ui-active");
    } else {
      body.classList.remove("native-ui-active");
    }
    return () => {
      body.classList.remove("native-ui-active");
    };
  }, [visible]);

  // 模型目录与界面生命周期解耦，失败静默降级（选择器显示目录不可用）
  useEffect(() => {
    rpc<ModelCatalog>(Endpoints.sessionModelCatalog, {})
      .then(setModelCatalog)
      .catch(() => setModelCatalog(null));
  }, []);

  /** 读取新会话默认权限（settings/describe 的 permission 命名空间）。 */
  const refreshDefaultPermission = useCallback(async () => {
    try {
      const described = await rpc<SettingsDescribeValue>(
        Endpoints.settingsDescribe,
        {},
      );
      const view = described.namespaces.find(
        (entry) => entry.ns === "permission",
      );
      const current = view?.value.defaultPreset;
      if (!view || typeof current !== "string") {
        setDefaultPermission(null);
        return;
      }
      const options = permissionPresetsFromSchema(view.schema);
      setDefaultPermission({
        options:
          options.length > 0 ? options : [{ value: current, name: current }],
        currentValue: current,
        writable: described.writable,
        revision: view.revision,
      });
    } catch {
      setDefaultPermission(null);
    }
  }, []);

  useEffect(() => {
    void refreshDefaultPermission();
  }, [refreshDefaultPermission]);

  useEffect(() => {
    if (workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].workspaceId);
    }
  }, [workspaces, activeWorkspaceId]);

  // 全局流：$events（会话增删/状态/审批/问答）+ workspace/follow（项目注册表）
  useEffect(() => {
    const openStream = (endpoint: string, payload: unknown) => {
      void qingwu.dshStreamOpen(endpoint, payload).catch((err) => {
        setError(
          `打开 ${endpoint} 流失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    };
    openStream("$events", {});
    openStream(Endpoints.workspaceFollow, {});

    const handleRemoteEvent = (frame: RemoteEventFrame) => {
      if (frame.type === "ready") {
        eventsClientIdRef.current = frame.clientId;
        return;
      }
      if (frame.type === "emit") {
        const [firstArg, secondArg] = Array.isArray(frame.args)
          ? frame.args
          : [];
        if (frame.event === "api-session/added" && firstArg) {
          const summary = firstArg as SessionSummary;
          setSessions((prev) => {
            const rest = prev.filter((s) => s.sessionId !== summary.sessionId);
            return [summary, ...rest];
          });
        } else if (
          frame.event === "api-session/removed" &&
          typeof firstArg === "string"
        ) {
          const removedId = firstArg;
          setSessions((prev) => prev.filter((s) => s.sessionId !== removedId));
          // 会话已删除，草稿桶与图片一并清理（内存态，避免残留）
          composerDraftsRef.current.delete(removedId);
          composerImagesRef.current.delete(removedId);
          if (currentIdRef.current === removedId) {
            setCurrentId(null);
          }
        } else if (frame.event === "api-session/status") {
          const sessionId = firstArg as string;
          const isRunning = Boolean(secondArg);
          if (currentIdRef.current === sessionId) setRunning(isRunning);
          setSessions((prev) =>
            prev.map((s) => {
              if (s.sessionId === sessionId) {
                if (s.running && !isRunning && currentIdRef.current !== sessionId) {
                  setUnreadFinishedSessionIds((u) => new Set(u).add(sessionId));
                }
                return { ...s, running: isRunning };
              }
              return s;
            }),
          );
        } else if (frame.event === "api-session/error") {
          const sessionId = firstArg as string;
          const message = secondArg as string;
          if (currentIdRef.current === sessionId) setError(message);
        } else if (frame.event === "api-session/activity") {
          scheduleRefresh();
        }
        return;
      }
      if (frame.type === "waterfall") {
        // agentId 就是归属会话 id（引擎里 Agent id 恒等于 Session id）：待处理项
        // 必须带着它入库，渲染时才能只落在发起请求的那个会话里。
        const sessionId = frame.agentId ?? "";
        if (frame.event === "approval/request") {
          const request = (frame.request ?? {}) as ApprovalRequestPayload;
          setApprovals((prev) =>
            prev.some((a) => a.eventId === frame.eventId)
              ? prev
              : [
                  ...prev,
                  {
                    ...request,
                    eventId: frame.eventId,
                    clientId: eventsClientIdRef.current ?? "",
                    sessionId,
                  },
                ],
          );
        } else if (frame.event === "user-questions/request") {
          const request = (frame.request ?? {}) as UserQuestionsRequestPayload;
          setQuestions((prev) =>
            prev.some((q) => q.eventId === frame.eventId)
              ? prev
              : [
                  ...prev,
                  {
                    ...request,
                    eventId: frame.eventId,
                    clientId: eventsClientIdRef.current ?? "",
                    sessionId,
                  },
                ],
          );
        }
        return;
      }
      if (frame.type === "cancel") {
        setApprovals((prev) => prev.filter((a) => a.eventId !== frame.eventId));
        setQuestions((prev) => prev.filter((q) => q.eventId !== frame.eventId));
      }
    };

    const handleWorkspaceFollow = (frame: WorkspaceFollowFrame) => {
      if (frame.type === "baseline") {
        setWorkspaces(frame.value?.items ?? []);
        setArchivedSessionIds(frame.value?.archivedSessionIds ?? []);
        return;
      }
      if (frame.type === "upsert" && frame.workspace) {
        setWorkspaces((prev) => upsertWorkspace(prev, frame.workspace!));
      } else if (frame.type === "remove" && frame.workspaceId) {
        setWorkspaces((prev) =>
          prev.filter((w) => w.workspaceId !== frame.workspaceId),
        );
      } else if (frame.type === "order" && Array.isArray(frame.workspaceIds)) {
        setWorkspaces((prev) => orderWorkspaces(prev, frame.workspaceIds!));
      } else if (
        frame.type === "archived" &&
        Array.isArray(frame.archivedSessionIds)
      ) {
        setArchivedSessionIds(frame.archivedSessionIds);
      }
    };

    const handleStreamItem = ({
      streamId: _streamId,
      endpoint,
      value,
    }: DshStreamItem) => {
      if (!isRecord(value)) return;
      if (value.type === "stream/error") {
        const err = value.error as { message?: string } | undefined;
        if (err?.message) setError(err.message);
        return;
      }
      if (endpoint === "$events") {
        handleRemoteEvent(value as unknown as RemoteEventFrame);
      } else if (endpoint === Endpoints.workspaceFollow) {
        handleWorkspaceFollow(value as unknown as WorkspaceFollowFrame);
      }
    };

    const unsubscribe = qingwu.onDshStreamItem(handleStreamItem);
    return () => {
      unsubscribe();
    };
  }, [scheduleRefresh]);

  // 选中会话：打开 session/follow 日志流（开场快照 + 实时事件）
  useEffect(() => {
    currentIdRef.current = currentId;
    if (sessionStreamRef.current) {
      qingwu.dshStreamCancel(sessionStreamRef.current);
      sessionStreamRef.current = null;
    }
    eventsRef.current = [];
    setItems([]);
    setDraft("");
    setLiveReasoning("");
    setReasoningActive(false);
    setToolCalling(false);
    stickBottomRef.current = true;
    setQueue([]);
    setEchoes([]);
    // 运行态从会话列表播种：进入一个正在跑的会话时必须立刻显示「停止」，
    // 不能等 status 事件（它只在跳变时发出，切换会话不会重放）。
    setRunning(
      sessionsRef.current.find((entry) => entry.sessionId === currentId)
        ?.running ?? false,
    );
    // 载入目标会话自己的草稿（上一个会话的草稿已在输入时写进各自的桶）
    setInput(composerDraftsRef.current.get(currentId ?? "") ?? "");
    setDraftImages(composerImagesRef.current.get(currentId ?? "") ?? []);
    if (!currentId) return;

    setLoadingHistory(true);
    let cancelled = false;
    /** 本代连接的 live 帧 revision；null 表示开场基线未声明，此时不做跳号检查。 */
    let assistantRevision: number | null = null;

    /** 清空流式展示态（切换会话／重连／开场基线／开始与放弃 attempt 共用）。 */
    const resetStreamingDisplay = () => {
      setDraft("");
      setLiveReasoning("");
      setReasoningActive(false);
      setToolCalling(false);
    };

    /**
     * 打开 follow 流。必须声明 assistantStream：0.1.5 起「正在输出的文本」与
     * 「正在思考的推理」只走 opted-in 的 live 帧，不声明就只能等 settlement，
     * 界面上表现为整段回复一次性出现、思考过程全程不可见。
     */
    const openFollow = () => {
      void qingwu
        .dshStreamOpen(Endpoints.sessionFollow, {
          request: {
            address: { kind: "session", sessionId: currentId },
            maxMessages: 100,
            assistantStream: true,
          },
        })
        .then((streamId) => {
          if (cancelled) {
            qingwu.dshStreamCancel(streamId);
            return;
          }
          sessionStreamRef.current = streamId;
        });
    };

    /** revision 跳号（漏帧/重连）后本代流已不可信：重开一次，由新开场帧重建界面状态。 */
    const resyncFollow = () => {
      if (sessionStreamRef.current) {
        qingwu.dshStreamCancel(sessionStreamRef.current);
        sessionStreamRef.current = null;
      }
      assistantRevision = null;
      resetStreamingDisplay();
      openFollow();
    };

    /**
     * 一条 live 增量折进流式展示态。
     *
     * 在飞块是不是思考块，首选 block-start 的声明：推理块开始的当口先按思考态
     * 渲染，一旦文本块或工具调用块开始，思考就已经是过去完成的过程，折叠行随之
     * 从「跟着最后一行」切回静态摘要。旧引擎（0.1.4 及以前）的 durable
     * assistant/chunk 只发增量、没有 block-start，那就按增量类型兜底。
     */
    const applyAssistantChunk = (chunk: AssistantBlockDelta) => {
      if (chunk.type === "block-start") {
        setReasoningActive(chunk.blockType === "reasoning");
        if (chunk.blockType === "tool-call") setToolCalling(true);
        return;
      }
      if (chunk.type === "text-delta" && typeof chunk.text === "string") {
        setReasoningActive(false);
        setDraft((prev) => prev + chunk.text);
      } else if (
        chunk.type === "reasoning-delta" &&
        typeof chunk.text === "string"
      ) {
        setReasoningActive(true);
        setLiveReasoning((prev) => prev + chunk.text);
      }
    };

    openFollow();

    const handleFollowItem = ({ streamId, endpoint, value }: DshStreamItem) => {
      if (
        cancelled ||
        endpoint !== Endpoints.sessionFollow ||
        streamId !== sessionStreamRef.current
      ) {
        return;
      }
      if (!isRecord(value)) return;
      if (value.type === "stream/error" || value.type === "stream/end") return;
      const frame = value as unknown as SessionFollowFrame;
      if (frame.type === "snapshot") {
        const events = frame.records
          .filter((record) => record.type === "event")
          .map((record) => record.event);
        eventsRef.current = events;
        refreshFromEvents();
        setLoadingHistory(false);
        // 开场基线：把在飞 attempt 已经产出的增量补回流式展示，
        // 否则切回正在输出的会话会空白到下一次 settlement 才出现整段回复。
        assistantRevision = frame.assistantStream?.revision ?? null;
        resetStreamingDisplay();
        const pending = frame.assistantStream?.activeAttempt?.stream;
        if (Array.isArray(pending)) {
          for (const chunk of expandStreamRecords(pending)) {
            applyAssistantChunk(chunk);
          }
        }
        return;
      }
      if (frame.type === "assistant-stream") {
        const live = frame.frame;
        if (
          assistantRevision !== null &&
          live.revision !== assistantRevision + 1
        ) {
          resyncFollow();
          return;
        }
        assistantRevision = live.revision;
        if (live.type === "start") {
          resetStreamingDisplay();
          return;
        }
        if (live.type === "chunk") {
          applyAssistantChunk(live.chunk);
          return;
        }
        // end：committed 时紧随其后的 durable settlement 会清空流式态，此处不动避免闪空；
        // 被放弃的 attempt 不会再有 settlement，必须就地清掉，否则残留半截文本。
        if (live.outcome.kind === "abandoned") {
          resetStreamingDisplay();
        }
        return;
      }
      if (frame.type === "event") {
        const event = frame.event;
        if (event.type === "assistant/chunk") {
          // 旧引擎（0.1.4 及以前）的过程内增量走 durable 事件，保留兼容。
          const chunk = (event.data as AssistantChunkEventData | null)?.chunk;
          if (!chunk) return;
          applyAssistantChunk(chunk);
          return;
        }
        if (event.type === "assistant/message") {
          resetStreamingDisplay();
        }
        appendEvent(event);
      }
    };
    const unsubscribe = qingwu.onDshStreamItem(handleFollowItem);
    return () => {
      cancelled = true;
      unsubscribe();
      if (sessionStreamRef.current) {
        qingwu.dshStreamCancel(sessionStreamRef.current);
        sessionStreamRef.current = null;
      }
    };
  }, [currentId, appendEvent, refreshFromEvents]);

  // 自动滚动：仅当用户位于底部附近时贴底跟随
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (stickBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [items, draft, liveReasoning, toolCalling, approvals, questions]);

  const archivedSet = useMemo(
    () => new Set(archivedSessionIds),
    [archivedSessionIds],
  );

  // 若当前打开的会话在外部被归档，清空选中态回退引导页
  useEffect(() => {
    if (currentId && archivedSet.has(currentId)) {
      setCurrentId(null);
    }
  }, [currentId, archivedSet]);

  /** 子代理会话（主对话派生的辅助会话）与已归档会话不在主列表展示。 */
  const visibleSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          !s.blank && s.origin !== "subagent" && !archivedSet.has(s.sessionId),
      ),
    [sessions, archivedSet],
  );

  /** 会话 id → 摘要（待处理项归位要按 parentSessionId 找根会话）。 */
  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.sessionId, s])),
    [sessions],
  );

  /**
   * 待处理项按归属会话归拢：审批/问答只属于发起它的那个会话。
   * `orphanPending` 是归属会话已不在列表里的项（例如会话被删除、帧缺 agentId）——
   * 这类项在界面上没有任何入口可答，兜底显示在当前会话里，至少还能提交或放弃。
   */
  const { pendingBySession, orphanPending } = useMemo(() => {
    const bySession = new Map<string, PendingEntry[]>();
    const orphans: PendingEntry[] = [];
    const push = (entry: PendingEntry) => {
      if (!entry.owner || !sessionById.has(entry.owner)) {
        orphans.push(entry);
        return;
      }
      const list = bySession.get(entry.owner);
      if (list) list.push(entry);
      else bySession.set(entry.owner, [entry]);
    };
    for (const approval of approvals) {
      push({
        kind: "approval",
        approval,
        owner: ownerSessionOf(approval.sessionId, sessionById),
      });
    }
    for (const question of questions) {
      push({
        kind: planReviewOf(question.questions ?? []) ? "plan-review" : "question",
        question,
        owner: ownerSessionOf(question.sessionId, sessionById),
      });
    }
    // 同一会话内多条并存时只展示优先级最高的一条（对齐官方的 composer 位）
    for (const list of bySession.values()) {
      list.sort(
        (a, b) => PENDING_PRECEDENCE[b.kind] - PENDING_PRECEDENCE[a.kind],
      );
    }
    return { pendingBySession: bySession, orphanPending: orphans };
  }, [approvals, questions, sessionById]);

  /** 侧栏会话行的等待提示：该会话在等什么。 */
  const pendingKindBySession = useMemo(() => {
    const map = new Map<string, PendingKind>();
    for (const [sessionId, list] of pendingBySession) {
      const first = list[0];
      if (first) map.set(sessionId, first.kind);
    }
    return map;
  }, [pendingBySession]);

  /**
   * 当前展示的待处理项：本会话优先级最高的一条；本会话没有时退回兜底项。
   * 同一批还有别的条目时用 `morePending` 提示条数（引擎按顺序等待，处理完接着出现）。
   */
  const currentPending =
    (currentId ? pendingBySession.get(currentId) : undefined) ?? [];
  const shownList = currentPending.length > 0 ? currentPending : orphanPending;
  const shownPending = shownList[0] ?? null;
  const morePending = shownList.length - 1;

  /** 会话标题：AI 生成/用户命名的 title 投影优先，回退工作目录名。 */
  const sessionTitle = (session: SessionSummary): string => {
    const title = session.projections?.values?.title;
    if (typeof title === "string" && title.trim()) return title;
    if (session.cwd)
      return session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "未命名";
    return "未命名";
  };

  const pinnedWsSet = useMemo(
    () => new Set(pinnedData.workspaces),
    [pinnedData.workspaces],
  );
  const pinnedSessionSet = useMemo(
    () => new Set(pinnedData.sessions),
    [pinnedData.sessions],
  );

  const filteredVisibleSessions = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return visibleSessions;
    return visibleSessions.filter((s) =>
      sessionTitle(s).toLowerCase().includes(keyword),
    );
  }, [visibleSessions, searchText]);

  const filteredSessionById = useMemo(
    () => new Map(filteredVisibleSessions.map((s) => [s.sessionId, s])),
    [filteredVisibleSessions],
  );

  const allWsSessionIds = useMemo(
    () => new Set(workspaces.flatMap((ws) => ws.sessionIds)),
    [workspaces],
  );

  /** 获取指定工作区下当前匹配的有效会话（保持工作区登记顺序） */
  const getWorkspaceSessions = useCallback(
    (ws: WorkspaceView) => {
      return ws.sessionIds
        .map((id) => filteredSessionById.get(id))
        .filter((s): s is SessionSummary => Boolean(s));
    },
    [filteredSessionById],
  );

  /** 判断工作区在搜索态下是否应呈现（名称匹配或内部有匹配会话） */
  const isWorkspaceMatched = useCallback(
    (ws: WorkspaceView, wsSessions: SessionSummary[]) => {
      const keyword = searchText.trim().toLowerCase();
      if (!keyword) return true;
      if (ws.title.toLowerCase().includes(keyword)) return true;
      return wsSessions.length > 0;
    },
    [searchText],
  );

  // 1. 置顶项目（保持置顶时间倒序）
  const pinnedWorkspaces = useMemo(() => {
    const wsMap = new Map(workspaces.map((w) => [w.workspaceId, w]));
    return pinnedData.workspaces
      .map((id) => wsMap.get(id))
      .filter((w): w is WorkspaceView => Boolean(w));
  }, [workspaces, pinnedData.workspaces]);

  // 2. 置顶会话（保持置顶时间倒序，包含独立会话与项目内会话）
  const pinnedSessionsList = useMemo(() => {
    return pinnedData.sessions
      .map((id) => filteredSessionById.get(id))
      .filter((s): s is SessionSummary => Boolean(s));
  }, [pinnedData.sessions, filteredSessionById]);

  // 3. 普通项目（排除已置顶的项目）
  const normalWorkspaces = useMemo(() => {
    return workspaces.filter((ws) => !pinnedWsSet.has(ws.workspaceId));
  }, [workspaces, pinnedWsSet]);

  // 4. 普通独立会话（未关联项目且未置顶）
  const normalUngroupedSessions = useMemo(() => {
    return filteredVisibleSessions.filter(
      (s) =>
        !allWsSessionIds.has(s.sessionId) && !pinnedSessionSet.has(s.sessionId),
    );
  }, [filteredVisibleSessions, allWsSessionIds, pinnedSessionSet]);

  /** 会话 → 所属工作区映射（点击会话时更新活跃工作区）。 */
  const workspaceOfSession = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) {
      for (const id of ws.sessionIds) map.set(id, ws.workspaceId);
    }
    return map;
  }, [workspaces]);

  /** 当前会话工作目录（工具卡片相对路径基准）。 */
  const currentCwd = useMemo(
    () => sessions.find((s) => s.sessionId === currentId)?.cwd,
    [sessions, currentId],
  );

  /**
   * 当前会话的用量/上下文投影（占用环数据源）。来自 session/list 的投影列，
   * 与官方 useProjection 同源同口径；引擎未报采样或路线容量时环不渲染。
   */
  const currentProjections = useMemo(
    () => sessions.find((s) => s.sessionId === currentId)?.projections?.values,
    [sessions, currentId],
  );

  /** 当前会话标题（聊天标题栏展示）。 */
  const currentTitle = useMemo(() => {
    const session = sessions.find((s) => s.sessionId === currentId);
    return session ? sessionTitle(session) : "";
  }, [sessions, currentId]);

  /** 当前会话摘要（新会话引导页判定需要它的 blank 标记）。 */
  const currentSession = useMemo(
    () => sessions.find((s) => s.sessionId === currentId) ?? null,
    [sessions, currentId],
  );

  /**
   * 是否渲染新会话引导页（居中问候 + 居中输入框）：
   * - 尚未选中任何会话（应用启动时）；或
   * - 选中的是刚建出的空白会话，且尚无任何消息、未在运行。
   * 「新会话」立即在宿主建出空白会话，若只按 !currentId 判定，用户会看到一个
   * 没有问候语、正文全空的会话页；其他产品在发出第一条消息前都停留在引导页。
   */
  const showGreeting = useMemo(
    () =>
      !currentId ||
      (currentSession?.blank === true && items.length === 0 && !running),
    [currentId, currentSession, items, running],
  );

  /** 当前生效的模型选择：会话投影优先（next 含待生效），空态用待应用选择或目录默认。 */
  const currentModelSelection = useMemo<ModelSelection | null>(() => {
    if (currentId) {
      const projection = sessions.find((s) => s.sessionId === currentId)
        ?.projections?.values?.modelSelection;
      return (
        projection?.next ??
        projection?.lastUsed ??
        modelCatalog?.default ??
        null
      );
    }
    return emptySelection ?? modelCatalog?.default ?? null;
  }, [currentId, sessions, emptySelection, modelCatalog]);

  /** 权限选择器数据：会话内取该会话投影，空态取新会话默认（settings permission.defaultPreset）。 */
  const currentPermission = useMemo<PermissionSelect | null>(() => {
    if (currentId) {
      return (
        sessions.find((s) => s.sessionId === currentId)?.projections?.values
          ?.permissions ?? null
      );
    }
    return defaultPermission;
  }, [currentId, sessions, defaultPermission]);

  /** 应用模型选择到会话并刷新投影（reasoningEffort 缺省用模型默认档）。 */
  const applyModelSelection = useCallback(
    async (selection: ModelSelection, sessionId: string) => {
      await rpc(Endpoints.sessionSelectModel, {
        request: { sessionId, ...selection },
      });
      await refreshSessions();
    },
    [refreshSessions],
  );

  /** 选择模型：会话内立即生效（下一轮起），空态暂存随建会话写入；强度回落新模型默认档。 */
  const handleModelPick = (selection: ModelSelection) => {
    if (currentId) {
      void applyModelSelection(selection, currentId).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    } else {
      setEmptySelection(selection);
    }
  };

  /** 调整推理强度：在当前选择基础上覆盖 reasoningEffort。 */
  const handleEffortPick = (effortId: string) => {
    if (!currentModelSelection) return;
    const selection = { ...currentModelSelection, reasoningEffort: effortId };
    if (currentId) {
      void applyModelSelection(selection, currentId).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    } else {
      setEmptySelection(selection);
    }
  };

  /**
   * 切换权限模式：会话内走宿主 /permission 命令（改该会话权限），
   * 空态写 settings permission.defaultPreset（改后续新建会话的默认权限）。
   */
  const handlePermissionPick = (value: string) => {
    if (currentId) {
      void (async () => {
        await rpc(Endpoints.commandsExecute, {
          agentId: currentId,
          line: `/permission ${value}`,
          images: [],
        });
        await refreshSessions();
      })().catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
      return;
    }
    if (!defaultPermission?.writable) return;
    void (async () => {
      await rpc(Endpoints.settingsMutate, {
        ns: "permission",
        ops: [{ op: "set", path: ["defaultPreset"], value }],
        expectedRevision: defaultPermission.revision,
      });
      await refreshDefaultPermission();
    })().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  /** 右侧面板数据：todo_write 最新状态 + edit/write 文件聚合，失败调用不计入。 */
  const panelData = useMemo(() => {
    const failedCalls = new Set<string>();
    const toolCalls: ToolCallEventData[] = [];
    for (const event of eventsRef.current) {
      if (event.type === "tool/call") {
        const data = event.data as ToolCallEventData | null;
        if (data && typeof data.arguments === "string") toolCalls.push(data);
      } else if (event.type === "tool/result") {
        const data = event.data as ToolResultEventData | null;
        const block = data?.message?.content?.[0];
        if (
          data &&
          block &&
          block.type === "tool-result" &&
          (data.error || block.isError)
        ) {
          failedCalls.add(block.toolCallId);
        }
      }
    }
    let todos: TodoEntry[] | null = null;
    const files = new Map<string, FileChangeEntry>();
    for (const data of toolCalls) {
      if (failedCalls.has(data.callId)) continue;
      try {
        const args = JSON.parse(data.arguments) as EditArgs &
          WriteArgs &
          TodoWriteArgs;
        if (data.name === "todo_write") {
          if (Array.isArray(args.todos)) todos = args.todos;
        } else if (data.name === "edit" || data.name === "write") {
          if (typeof args.file_path === "string" && args.file_path) {
            const entry: FileChangeEntry = files.get(args.file_path) ?? {
              path: args.file_path,
              edits: 0,
              writes: 0,
            };
            if (data.name === "edit") {
              entry.edits += 1;
              if (typeof args.old_string === "string") {
                entry.lastEdit = {
                  oldStr: args.old_string,
                  newStr: args.new_string ?? "",
                };
              }
            } else {
              entry.writes += 1;
              if (typeof args.content === "string") {
                entry.lastEdit = { oldStr: "", newStr: args.content };
              }
            }
            files.set(args.file_path, entry);
          }
        }
      } catch {
        // 参数非合法 JSON 时跳过该条
      }
    }
    return { todos, fileChanges: Array.from(files.values()) };
  }, [items]);

  const openSession = (sessionId: string) => {
    setCurrentId(sessionId);
    setUnreadFinishedSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    const wsId = workspaceOfSession.get(sessionId);
    if (wsId) setActiveWorkspaceId(wsId);
  };

  /** 在指定项目下落一个新会话：优先复用其空白会话（官方 connectWorkspace 语义）。返回会话 id。 */
  const createSessionIn = async (wsId: string): Promise<string> => {
    const ws = workspaces.find((w) => w.workspaceId === wsId);
    const reusable = ws?.sessionIds
      .map((id) => sessions.find((s) => s.sessionId === id))
      .find(
        (s) =>
          s?.blank && s.origin !== "subagent" && !archivedSet.has(s.sessionId),
      );
    if (reusable) {
      setCurrentId(reusable.sessionId);
      return reusable.sessionId;
    }
    const value = await rpc<{ sessionId: string }>(Endpoints.sessionCreate, {
      request: { workspaceId: wsId },
    });
    await refreshSessions();
    setCurrentId(value.sessionId);
    return value.sessionId;
  };

  /**
   * 新会话：对齐官方 startSession 语义——落在当前/最近活跃项目并复用空白会话；
   * 零项目时先添加第一个项目（添加工作区统一收口到聊天框 chip，这里是兜底）。
   */
  const handleNewSession = async () => {
    let wsId = activeWorkspaceId;
    if (!wsId) {
      wsId = await handleAddWorkspace();
      if (!wsId) return;
    }
    try {
      await createSessionIn(wsId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 选目录并注册工作区；用户取消返回 null。 */
  const addWorkspace = async (): Promise<string | null> => {
    const picked = await rpc<string | null>(Endpoints.directoryPickerPick, {});
    if (!picked) return null;
    const created = await rpc<{ workspace: WorkspaceView; created: boolean }>(
      Endpoints.workspaceCreate,
      { request: { path: picked } },
    );
    setActiveWorkspaceId(created.workspace.workspaceId);
    await refreshSessions();
    return created.workspace.workspaceId;
  };

  /** 添加工作区入口（chip 菜单/零工作区兜底）：添加后不建会话，新会话落点已指向它。 */
  const handleAddWorkspace = async (): Promise<string | null> => {
    try {
      return await addWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  /** 重命名工作区（workspace/rename，follow 流推送 upsert 自动回填列表）。 */
  const handleWorkspaceRename = (workspaceId: string, title: string) => {
    void rpc(Endpoints.workspaceRename, {
      request: { workspaceId, title },
    }).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  /** 删除工作区注册：会话归入「未分组」，活跃落点回退到剩余首个工作区。 */
  const handleWorkspaceDelete = (workspaceId: string) => {
    void (async () => {
      await rpc(Endpoints.workspaceDelete, { request: { workspaceId } });
      if (activeWorkspaceId === workspaceId) {
        const rest = workspaces.find((w) => w.workspaceId !== workspaceId);
        setActiveWorkspaceId(rest?.workspaceId ?? null);
      }
    })().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  /** 重命名会话（session/rename，更新本地会话投影标题）。 */
  const handleSessionRename = useCallback(
    async (sessionId: string, title: string) => {
      try {
        await rpc(Endpoints.sessionRename, {
          request: { sessionId, title },
        });
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === sessionId
              ? {
                  ...s,
                  projections: s.projections
                    ? {
                        ...s.projections,
                        values: { ...s.projections.values, title },
                      }
                    : {
                        asOfSeq: 0,
                        values: { title },
                      },
                }
              : s,
          ),
        );
        await refreshSessions();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  /** 归档会话（workspace/archiveSession，从主列表排除）。 */
  const handleSessionArchive = useCallback(
    async (sessionId: string) => {
      try {
        await rpc(Endpoints.workspaceArchiveSession, {
          request: { sessionId },
        });
        setArchivedSessionIds((prev) => [...prev, sessionId]);
        if (currentId === sessionId) {
          setCurrentId(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentId],
  );

  /**
   * 引导页工作区 chip 选择：切换新会话落点——在目标工作区建/复用一个空白会话再切过去。
   * 引擎不支持给已有会话改工作区归属：工作区归属在会话创建时按 cwd 写死，而
   * workspace/insertSessionBefore 只受理该项目已登记的会话，跨项目一律 workspace/move-invalid。
   * 因此这里对齐官方 openWorkspace 语义——换的是落点而不是会话本身：未发送的草稿随人迁移，
   * 原来那个空白会话留在原工作区，下次进入该工作区时被复用。
   */
  const handleWorkspaceChipPick = (workspaceId: string) => {
    if (!currentId) {
      setActiveWorkspaceId(workspaceId);
      return;
    }
    if (workspaceOfSession.get(currentId) === workspaceId) return;
    void (async () => {
      const previousId = currentId;
      const nextId = await createSessionIn(workspaceId);
      setActiveWorkspaceId(workspaceId);
      if (nextId === previousId) return;
      // 草稿随人走：旧会话的草稿落到目标会话，旧桶清空，避免回头再进它时又冒出来
      const pending = composerDraftsRef.current.get(previousId);
      if (pending !== undefined) {
        composerDraftsRef.current.set(nextId, pending);
        composerDraftsRef.current.delete(previousId);
      }
      const pendingImgs = composerImagesRef.current.get(previousId);
      if (pendingImgs !== undefined) {
        composerImagesRef.current.set(nextId, pendingImgs);
        composerImagesRef.current.delete(previousId);
      }
    })().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  const handleAddImages = useCallback((files: File[]) => {
    const valid: File[] = [];
    for (const f of files) {
      if (!isSupportedImage(f)) {
        setError(`不支持的图片格式: ${f.name}。仅支持 PNG、JPEG、WebP、GIF`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setError(`图片 ${f.name} 超过 20MB 上限`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length === 0) return;

    setDraftImages((prev) => {
      if (prev.length + valid.length > MAX_IMAGES_PER_MESSAGE) {
        setError(`单条消息最多添加 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
        return prev;
      }
      const newItems: DraftImage[] = valid.map((file) => {
        const id = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        const mediaType = getImageMediaType(file);
        const name = file.name || `image-${Date.now()}.png`;
        const item: DraftImage = {
          id,
          file,
          previewUrl,
          mediaType,
          name,
        };
        fileToBase64(file)
          .then((b64) => {
            item.base64 = b64;
            const dataUrl = `data:${mediaType};base64,${b64}`;
            item.previewUrl = dataUrl;
            setDraftImages((cur) =>
              cur.map((d) =>
                d.id === id ? { ...d, base64: b64, previewUrl: dataUrl } : d,
              ),
            );
          })
          .catch(() => {});
        return item;
      });
      const next = [...prev, ...newItems];
      const key = currentIdRef.current ?? "";
      composerImagesRef.current.set(key, next);
      return next;
    });
  }, []);

  const handleRemoveDraftImage = useCallback((id: string) => {
    setDraftImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const next = prev.filter((img) => img.id !== id);
      const key = currentIdRef.current ?? "";
      if (next.length > 0) composerImagesRef.current.set(key, next);
      else composerImagesRef.current.delete(key);
      return next;
    });
  }, []);

  // 全局剪贴板粘贴监听：未聚焦输入框时粘贴图片也自动加入当前草稿并聚焦
  useEffect(() => {
    const onGlobalPaste = (e: ClipboardEvent) => {
      // 只要光标在任何输入元素（包括主输入框），都由该元素自身的 onPaste 独立处理，此处直接跳过
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;
      const imageFiles: File[] = [];
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];
          if (isSupportedImage(file)) imageFiles.push(file);
        }
      } else if (clipboardData.items) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file && isSupportedImage(file)) imageFiles.push(file);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleAddImages(imageFiles);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("paste", onGlobalPaste);
    return () => window.removeEventListener("paste", onGlobalPaste);
  }, [handleAddImages]);

  const handleChatDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleChatDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const imageFiles: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (isSupportedImage(file)) {
          imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleAddImages(imageFiles);
        textareaRef.current?.focus();
      }
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    const images = [...draftImages];
    if (!text && images.length === 0) return;
    let sessionId = currentId;
    if (!sessionId) {
      let wsId = activeWorkspaceId;
      if (!wsId) {
        wsId = await handleAddWorkspace();
        if (!wsId) return;
      }
      try {
        sessionId = await createSessionIn(wsId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      // 空态选定的模型随会话创建写入；失败不阻断发送，回落默认模型
      if (emptySelection) {
        try {
          await rpc(Endpoints.sessionSelectModel, {
            request: { sessionId, ...emptySelection },
          });
        } catch {
          // 保持发送流程继续
        }
        setEmptySelection(null);
      }
    }
    setInput("");
    setDraftImages([]);
    // 发出即清空该会话的草稿桶；失败时再写回（输入框高度由 Composer 按 value 重算）
    composerDraftsRef.current.delete(sessionId);
    composerImagesRef.current.delete(sessionId);
    // 乐观回显：提交当帧就显示，宿主落库或入队后由 refreshFromEvents 退休
    const requestId = crypto.randomUUID();
    setEchoes((prev) => [
      ...prev,
      {
        id: `echo-${requestId}`,
        rpcId: requestId,
        placement: "next-turn",
        text,
        images: images.map((img) => ({
          id: img.id,
          url: img.previewUrl,
          name: img.name,
        })),
        pending: true,
      },
    ]);
    try {
      const content: Array<
        | { type: "text"; text: string }
        | {
            type: "image";
            mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
            data: string;
            name?: string;
          }
      > = [];
      for (const img of images) {
        const base64 = img.base64 || (await fileToBase64(img.file));
        content.push({
          type: "image",
          mediaType: img.mediaType,
          data: base64,
          ...(img.name ? { name: img.name } : {}),
        });
      }
      if (text) {
        content.push({ type: "text", text });
      }

      await rpc(Endpoints.sessionPrompt, {
        request: {
          requestId,
          sessionId,
          mode: "queue",
          content,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInput(text);
      setDraftImages(images);
      composerDraftsRef.current.set(sessionId, text);
      composerImagesRef.current.set(sessionId, images);
      setEchoes((prev) => prev.filter((echo) => echo.rpcId !== requestId));
    }
  };

  /** 队列条目变更（编辑／删除／插话）：成功后由 agent/inbox/spliced 回推队列。 */
  const handleQueueAction = async (
    item: QueuedItem,
    action: QueueAction,
  ) => {
    if (!currentId || item.pending) return;
    setQueueBusyId(item.id);
    try {
      await rpc(Endpoints.sessionUpdateQueue, {
        request: { sessionId: currentId, itemId: item.id, action },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusyId(null);
    }
  };

  /**
   * 输入变化：立即把内容写进当前会话的草稿桶（无会话时用空串键），
   * 这样切换会话时无需在 effect 里回头保存上一个会话的内容。
   */
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    const key = currentIdRef.current ?? "";
    if (value) composerDraftsRef.current.set(key, value);
    else composerDraftsRef.current.delete(key);
  }, []);

  const handleApproval = async (
    approval: PendingApproval,
    outcome: "allowed-once" | "rejected",
  ) => {
    const clientId = approval.clientId || eventsClientIdRef.current || "";
    if (!clientId) {
      setError("与引擎的事件流尚未就绪，请稍后重试");
      return;
    }
    const result = await qingwu.dshEventResult(clientId, approval.eventId, {
      kind: "result",
      value: outcome,
    });
    if (!result.ok) {
      setError(`授权回执提交失败：${result.error.message}`);
      return;
    }
    setApprovals((prev) => prev.filter((a) => a.eventId !== approval.eventId));
  };

  /**
   * 回答一个提问请求：一次提交该请求下所有题目的答案（引擎按题回填，缺题会变成不完整回答）。
   * 回执用的 clientId 优先取请求携带值，为空时回落到当前事件流（重连竞态下可能尚未写入）。
   */
  const handleQuestionAnswer = async (
    question: PendingQuestion,
    answers: UserQuestionAnswer[],
  ): Promise<boolean> => {
    const clientId = question.clientId || eventsClientIdRef.current || "";
    if (!clientId) {
      setError("与引擎的事件流尚未就绪，请稍后重试");
      return false;
    }
    try {
      const result = await qingwu.dshEventResult(clientId, question.eventId, {
        kind: "result",
        value: { answers },
      });
      if (!result.ok) {
        setError(`回答提交失败：${result.error.message}`);
        return false;
      }
      setQuestions((prev) =>
        prev.filter((q) => q.eventId !== question.eventId),
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  /**
   * 放弃整个提问等待（ASK_CANCELLED）：宿主按「用户要求自己说」处理，
   * 让编辑器归位，用户可以直接输入想法（plan-review 时模型会留在计划模式等消息）。
   */
  const handleQuestionDismiss = async (
    question: PendingQuestion,
  ): Promise<boolean> => {
    const clientId = question.clientId || eventsClientIdRef.current || "";
    if (!clientId) {
      setError("与引擎的事件流尚未就绪，请稍后重试");
      return false;
    }
    try {
      const result = await qingwu.dshEventResult(clientId, question.eventId, {
        kind: "rejected",
        error: {
          name: "UserQuestionError",
          message: "the user dismissed the question to speak instead",
          code: "ASK_CANCELLED",
        },
      });
      if (!result.ok) {
        setError(`取消失败：${result.error.message}`);
        return false;
      }
      setQuestions((prev) =>
        prev.filter((q) => q.eventId !== question.eventId),
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const handleStop = async () => {
    if (!currentId) return;
    try {
      await rpc(Endpoints.sessionCancel, { request: { sessionId: currentId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!visible) return null;

  /** 工作区 chip 绑定：会话内取所属工作区（未绑定为 null），空态取新会话落点。 */
  const chipWorkspaceId = currentId
    ? (workspaceOfSession.get(currentId) ?? null)
    : activeWorkspaceId;

  return (
    <div className={`native-app${!sidebarCollapsed ? " has-sidebar" : ""}`}>
      {!sidebarCollapsed && (
        <>
          <aside
            className="native-sidebar"
            style={{ width: sidebarPanel.width }}
          >
            <div className="native-sidebar-brand">
              <span>青梧</span>
              <button
                className="native-sidebar-search-toggle"
                onClick={() => {
                  setSearchOpen((v) => !v);
                  setSearchText("");
                }}
                title="搜索会话"
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
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </button>
            </div>
            {searchOpen && (
              <div className="native-sidebar-search">
                <input
                  autoFocus
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="搜索会话"
                />
              </div>
            )}
            <button
              className="native-nav-item"
              onClick={() => void handleNewSession()}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              新会话
            </button>
            <div className="native-session-list">
              {/* 1. 置顶区间 */}
              {(pinnedWorkspaces.length > 0 ||
                pinnedSessionsList.length > 0) && (
                <div className="native-sidebar-section">
                  <div className="native-sidebar-section-header">
                    <span className="native-sidebar-section-title">置顶</span>
                  </div>
                  <div className="native-sidebar-section-content">
                    {pinnedWorkspaces.map((ws) => {
                      const wsSessions = getWorkspaceSessions(ws);
                      if (!isWorkspaceMatched(ws, wsSessions)) return null;
                      return (
                        <div
                          key={ws.workspaceId}
                          className="native-session-group native-session-group-ws"
                        >
                          <WorkspaceRow
                            workspace={ws}
                            collapsed={collapsedGroups.has(ws.workspaceId)}
                            pinned={true}
                            onToggle={() =>
                              setCollapsedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(ws.workspaceId))
                                  next.delete(ws.workspaceId);
                                else next.add(ws.workspaceId);
                                return next;
                              })
                            }
                            onNewSession={() =>
                              void createSessionIn(ws.workspaceId).catch((err) =>
                                setError(
                                  err instanceof Error ? err.message : String(err),
                                ),
                              )
                            }
                            onRename={(title) =>
                              handleWorkspaceRename(ws.workspaceId, title)
                            }
                            onDelete={() => handleWorkspaceDelete(ws.workspaceId)}
                            onTogglePin={() => toggleWorkspacePin(ws.workspaceId)}
                          />
                          {!collapsedGroups.has(ws.workspaceId) &&
                            wsSessions.map((session) => (
                              <SessionRow
                                key={session.sessionId}
                                title={sessionTitle(session)}
                                tooltip={session.cwd ?? session.sessionId}
                                active={session.sessionId === currentId}
                                pinned={pinnedSessionSet.has(session.sessionId)}
                                running={session.running}
                                pending={
                                  pendingKindBySession.get(session.sessionId) ??
                                  null
                                }
                                unread={unreadFinishedSessionIds.has(
                                  session.sessionId,
                                )}
                                indented
                                onClick={() => openSession(session.sessionId)}
                                onTogglePin={() =>
                                  toggleSessionPin(session.sessionId)
                                }
                                onRename={(t) =>
                                  void handleSessionRename(session.sessionId, t)
                                }
                                onArchive={() =>
                                  void handleSessionArchive(session.sessionId)
                                }
                              />
                            ))}
                        </div>
                      );
                    })}
                    {pinnedSessionsList.map((session) => (
                      <SessionRow
                        key={session.sessionId}
                        title={sessionTitle(session)}
                        tooltip={session.cwd ?? session.sessionId}
                        active={session.sessionId === currentId}
                        pinned={true}
                        running={session.running}
                        pending={
                          pendingKindBySession.get(session.sessionId) ?? null
                        }
                        unread={unreadFinishedSessionIds.has(session.sessionId)}
                        onClick={() => openSession(session.sessionId)}
                        onTogglePin={() => toggleSessionPin(session.sessionId)}
                        onRename={(t) =>
                          void handleSessionRename(session.sessionId, t)
                        }
                        onArchive={() =>
                          void handleSessionArchive(session.sessionId)
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 2. 项目区间 */}
              <div className="native-sidebar-section">
                <div className="native-sidebar-section-header">
                  <span className="native-sidebar-section-title">项目</span>
                  <button
                    className="native-sidebar-section-act"
                    onClick={() => void handleAddWorkspace()}
                    title="添加项目"
                    aria-label="添加项目"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>
                <div className="native-sidebar-section-content">
                  {normalWorkspaces.map((ws) => {
                    const wsSessions = getWorkspaceSessions(ws);
                    if (!isWorkspaceMatched(ws, wsSessions)) return null;
                    return (
                      <div
                        key={ws.workspaceId}
                        className="native-session-group native-session-group-ws"
                      >
                        <WorkspaceRow
                          workspace={ws}
                          collapsed={collapsedGroups.has(ws.workspaceId)}
                          pinned={false}
                          onToggle={() =>
                            setCollapsedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(ws.workspaceId))
                                next.delete(ws.workspaceId);
                              else next.add(ws.workspaceId);
                              return next;
                            })
                          }
                          onNewSession={() =>
                            void createSessionIn(ws.workspaceId).catch((err) =>
                              setError(
                                err instanceof Error ? err.message : String(err),
                              ),
                            )
                          }
                          onRename={(title) =>
                            handleWorkspaceRename(ws.workspaceId, title)
                          }
                          onDelete={() => handleWorkspaceDelete(ws.workspaceId)}
                          onTogglePin={() => toggleWorkspacePin(ws.workspaceId)}
                        />
                        {!collapsedGroups.has(ws.workspaceId) &&
                          wsSessions.map((session) => (
                            <SessionRow
                              key={session.sessionId}
                              title={sessionTitle(session)}
                              tooltip={session.cwd ?? session.sessionId}
                              active={session.sessionId === currentId}
                              pinned={pinnedSessionSet.has(session.sessionId)}
                              running={session.running}
                              pending={
                                pendingKindBySession.get(session.sessionId) ??
                                null
                              }
                              unread={unreadFinishedSessionIds.has(
                                session.sessionId,
                              )}
                              indented
                              onClick={() => openSession(session.sessionId)}
                              onTogglePin={() =>
                                toggleSessionPin(session.sessionId)
                              }
                              onRename={(t) =>
                                void handleSessionRename(session.sessionId, t)
                              }
                              onArchive={() =>
                                void handleSessionArchive(session.sessionId)
                              }
                            />
                          ))}
                      </div>
                    );
                  })}
                  {normalWorkspaces.length === 0 &&
                    pinnedWorkspaces.length === 0 && (
                      <div className="native-sidebar-empty-hint">暂无项目</div>
                    )}
                </div>
              </div>

              {/* 3. 会话区间（无项目独立日常会话） */}
              {normalUngroupedSessions.length > 0 && (
                <div className="native-sidebar-section">
                  <div className="native-sidebar-section-header">
                    <span className="native-sidebar-section-title">会话</span>
                  </div>
                  <div className="native-sidebar-section-content">
                    {normalUngroupedSessions.map((session) => (
                      <SessionRow
                        key={session.sessionId}
                        title={sessionTitle(session)}
                        tooltip={session.cwd ?? session.sessionId}
                        active={session.sessionId === currentId}
                        pinned={false}
                        running={session.running}
                        pending={
                          pendingKindBySession.get(session.sessionId) ?? null
                        }
                        unread={unreadFinishedSessionIds.has(session.sessionId)}
                        onClick={() => openSession(session.sessionId)}
                        onTogglePin={() => toggleSessionPin(session.sessionId)}
                        onRename={(t) =>
                          void handleSessionRename(session.sessionId, t)
                        }
                        onArchive={() =>
                          void handleSessionArchive(session.sessionId)
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

          <div
            className="native-resizer"
            role="separator"
            aria-orientation="vertical"
            title="拖动调节宽度，双击复位"
            onPointerDown={(e) => sidebarPanel.startDrag(e, 1)}
            onDoubleClick={sidebarPanel.reset}
          />
        </>
      )}

      <main
        className="native-chat"
        onDragOver={handleChatDragOver}
        onDrop={handleChatDrop}
      >
        {showGreeting ? (
          <>
            <div className="native-chat-header">
              {/* 侧栏开关已上移标题栏菜单栏；左端留空占位，右端面板按钮才有落点 */}
              <div className="native-chat-header-left" />
              <div className="native-chat-header-right">
                {/* 面板展开后按钮由面板顶栏右缘接管，按钮始终贴窗口右缘 */}
                {panelCollapsed && (
                  <button
                    className="native-icon-btn"
                    onClick={() => setPanelCollapsed((v) => !v)}
                    title="打开面板"
                    aria-label="打开面板"
                  >
                    <PanelIcon />
                  </button>
                )}
              </div>
            </div>
            <div className="native-empty">
              <div className="native-empty-title">有什么可以帮你？</div>
              <div className="native-composer-stack">
                <WorkspaceChip
                  workspaces={workspaces}
                  currentId={chipWorkspaceId}
                  fallbackLabel={activeWorkspaceId ? "未分组" : "选择工作区"}
                  onPick={handleWorkspaceChipPick}
                  onAdd={() => void handleAddWorkspace()}
                />
                <Composer
                  input={input}
                  onInputChange={handleInputChange}
                  onSend={() => void handleSend()}
                  running={false}
                  onStop={() => void handleStop()}
                  textareaRef={textareaRef}
                  draftImages={draftImages}
                  onRemoveDraftImage={handleRemoveDraftImage}
                  onAddImages={handleAddImages}
                  onPreviewImage={(url) => setLightboxUrl(url)}
                  meter={
                    <ContextMeter
                      pressure={currentProjections?.contextPressure}
                      breakdown={currentProjections?.contextBreakdown}
                    />
                  }
                  controls={
                    <ComposerControls
                      catalog={modelCatalog}
                      selection={currentModelSelection}
                      permission={currentPermission}
                      permissionHint={
                        currentId ? undefined : "新会话默认权限"
                      }
                      onModelPick={handleModelPick}
                      onEffortPick={handleEffortPick}
                      onPermissionPick={handlePermissionPick}
                    />
                  }
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="native-chat-header">
              <div className="native-chat-header-left">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
                </svg>
                <span className="native-chat-header-title">{currentTitle}</span>
              </div>
              <div className="native-chat-header-right">
                {/* 面板展开后按钮由面板顶栏右缘接管，按钮始终贴窗口右缘 */}
                {panelCollapsed && (
                  <button
                    className="native-icon-btn"
                    onClick={() => setPanelCollapsed((v) => !v)}
                    title="打开面板"
                    aria-label="打开面板"
                  >
                    <PanelIcon />
                  </button>
                )}
              </div>
            </div>
            <div
              className="native-messages"
              ref={scrollRef}
              onScroll={handleScroll}
            >
              <div className="native-messages-inner">
                {loadingHistory && (
                  <div className="native-hint">正在加载会话历史…</div>
                )}
                {items.map((view) => (
                  <TurnItems
                    key={view.turn}
                    view={view}
                    cwd={currentCwd}
                    sessionId={currentId}
                    onPreviewImage={(url) => setLightboxUrl(url)}
                  />
                ))}
                {(liveReasoning || draft || toolCalling) && (
                  // 本轮在飞内容合成一条助手消息：思考折叠行在上、正文在下，
                  // 与回合结束后的落库布局一致，收束时不会整块跳位。
                  <div className="native-msg assistant">
                    {liveReasoning && (
                      <ReasoningRow
                        text={liveReasoning}
                        running={reasoningActive}
                      />
                    )}
                    {draft ? (
                      <div className="native-msg-body">
                        <Markdown text={draft} />
                        <span className="native-cursor" />
                      </div>
                    ) : (
                      toolCalling &&
                      !liveReasoning && (
                        <div className="native-tool-hint">正在调用工具…</div>
                      )
                    )}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* 授权/问答等待期间顶替输入框（对齐各 harness 客户端：决策弹层占输入框的槽位） */}
            <div className="native-composer">
              <div className="native-composer-stack">
                <QueueStrip
                  items={[...queue, ...echoes]}
                  running={running}
                  busyId={queueBusyId}
                  onAction={(item, action) => void handleQueueAction(item, action)}
                />
                {shownPending ? (
                  <div className="native-interactions">
                    {shownPending.kind === "approval" ? (
                      <div className="native-card approval">
                        <div className="native-card-title">
                          请求授权：{shownPending.approval.toolName ?? "工具"}
                        </div>
                        {shownPending.approval.reason && (
                          <div className="native-card-text">
                            {shownPending.approval.reason}
                          </div>
                        )}
                        <div className="native-card-actions">
                          <button
                            className="primary"
                            onClick={() =>
                              void handleApproval(
                                shownPending.approval,
                                "allowed-once",
                              )
                            }
                          >
                            允许一次
                          </button>
                          <button
                            onClick={() =>
                              void handleApproval(
                                shownPending.approval,
                                "rejected",
                              )
                            }
                          >
                            拒绝
                          </button>
                        </div>
                      </div>
                    ) : (
                      <QuestionCard
                        key={shownPending.question.eventId}
                        request={shownPending.question}
                        onSubmit={(answers) =>
                          handleQuestionAnswer(shownPending.question, answers)
                        }
                        onDismiss={() =>
                          handleQuestionDismiss(shownPending.question)
                        }
                      />
                    )}
                    {morePending > 0 && (
                      <div className="native-pending-more">
                        另有 {morePending} 项等待处理，处理完这项后继续
                      </div>
                    )}
                  </div>
                ) : (
                  <Composer
                    input={input}
                    onInputChange={handleInputChange}
                    onSend={() => void handleSend()}
                    running={running}
                    onStop={() => void handleStop()}
                    textareaRef={textareaRef}
                    draftImages={draftImages}
                    onRemoveDraftImage={handleRemoveDraftImage}
                    onAddImages={handleAddImages}
                    onPreviewImage={(url) => setLightboxUrl(url)}
                    meter={
                      <ContextMeter
                        pressure={currentProjections?.contextPressure}
                        breakdown={currentProjections?.contextBreakdown}
                      />
                    }
                    controls={
                      <ComposerControls
                        catalog={modelCatalog}
                        selection={currentModelSelection}
                        permission={currentPermission}
                        onModelPick={handleModelPick}
                        onEffortPick={handleEffortPick}
                        onPermissionPick={handlePermissionPick}
                      />
                    }
                  />
                )}
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="native-error" onClick={() => setError(null)}>
            {error}（点击关闭）
          </div>
        )}
      </main>

      {lightboxUrl && (
        <LightboxModal
          src={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
        />
      )}

      {!panelCollapsed && (
        <div
          className="native-resizer"
          role="separator"
          aria-orientation="vertical"
          title="拖动调节宽度，双击复位"
          onPointerDown={(e) => rightPanel.startDrag(e, -1)}
          onDoubleClick={rightPanel.reset}
        />
      )}
      <RightPanel
        collapsed={panelCollapsed}
        width={rightPanel.width}
        todos={panelData.todos}
        fileChanges={panelData.fileChanges}
        onToggle={() => setPanelCollapsed((v) => !v)}
      />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
