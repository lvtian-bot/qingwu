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
  AssistantChunkEventData,
  EditArgs,
  ModelCatalog,
  ModelSelection,
  PermissionSelect,
  PresetOption,
  RemoteEventFrame,
  SessionEvent,
  SessionFollowFrame,
  SessionSummary,
  SettingsDescribeValue,
  ToolCallEventData,
  ToolResultEventData,
  TodoWriteArgs,
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
import { ToolCard, type ToolItem } from "./ToolCard";
import { RightPanel, type FileChangeEntry, type TodoEntry } from "./RightPanel";
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

interface ComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  running: boolean;
  onStop: () => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  /** 工具行左侧控件（模型/强度/权限选择器）。 */
  controls?: ReactNode;
}

/** 侧栏分组标题：点击折叠/展开会话列表（「未分组」等无工作区操作的分组用）。 */
function GroupHeader({
  title,
  collapsed,
  onToggle,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="native-group-title"
      onClick={onToggle}
      title={collapsed ? "展开分组" : "折叠分组"}
    >
      <span className="native-group-title-text">{title}</span>
      <svg
        className={`native-group-chevron${collapsed ? " collapsed" : ""}`}
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
  );
}

/**
 * 侧栏工作区行：胶囊底色 + 文件夹图标，点击主体展开/收起会话列表；
 * 悬停浮现「新建会话」与「···」操作菜单（重命名 / 删除），对齐 ChatGPT 桌面版项目分组。
 */
function WorkspaceRow({
  workspace,
  collapsed,
  onToggle,
  onNewSession,
  onRename,
  onDelete,
}: {
  workspace: WorkspaceView;
  collapsed: boolean;
  onToggle: () => void;
  onNewSession: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
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
              width="15"
              height="15"
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

/**
 * 输入框上方的工作区 chip：点击弹出工作区列表 + 添加入口。
 * 空态选择新会话落点；会话内切换时把当前会话移动到目标工作区。
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
        className="native-ws-chip"
        onClick={() => setOpen((v) => !v)}
        title="选择工作区"
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
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
        </svg>
        <span className="native-ws-chip-text">{label}</span>
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
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

/** 卡片式输入框：textarea + 底部工具行（左侧选择器 + 圆形发送/停止按钮），空态与底部共用。 */
function Composer({
  input,
  onInputChange,
  onSend,
  running,
  onStop,
  textareaRef,
  controls,
}: ComposerProps) {
  return (
    <div className="native-composer-box">
      <textarea
        ref={textareaRef}
        value={input}
        rows={1}
        placeholder="询问任何问题"
        onChange={(e) => {
          onInputChange(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="native-composer-bar">
        {/* 控件组自身占满工具行：权限贴左，模型与推理档位贴右（紧邻发送按钮） */}
        {controls ?? <span style={{ flex: 1 }} />}
        {running ? (
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
            className={`native-send${input.trim() ? "" : " empty"}`}
            disabled={!input.trim()}
            onClick={onSend}
            title="发送"
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
              width="13"
              height="13"
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
            width="13"
            height="13"
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
              width="13"
              height="13"
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

/** 待决策审批（$events 瀑布）。 */
interface PendingApproval extends ApprovalRequestPayload {
  eventId: string;
  clientId: string;
}

/** 待回答问答（$events 瀑布）。 */
interface PendingQuestion extends UserQuestionsRequestPayload {
  eventId: string;
  clientId: string;
}

/** 会话内渲染条目。 */
type ChatItem =
  | { kind: "user"; key: string; text: string; time: number }
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

function foldChatItems(events: SessionEvent[]): ChatItem[] {
  const tools = new Map<string, ToolItem>();
  const items: ChatItem[] = [];
  let lastUserTime: number | null = null;

  for (const event of events) {
    if (event.type === "user/message") {
      const data = event.data as {
        source?: { kind: string };
        content?: unknown[];
      } | null;
      if (data?.source?.kind === "user" && Array.isArray(data.content)) {
        lastUserTime = event.time;
        items.push({
          kind: "user",
          key: `u-${event.seq}`,
          text: textOf(data.content, "text"),
          time: event.time,
        });
      }
    } else if (event.type === "assistant/message") {
      const data = event.data as {
        message?: { content?: unknown[] };
        interrupted?: true;
      } | null;
      const content = data?.message?.content;
      items.push({
        kind: "assistant",
        key: `a-${event.seq}`,
        text: content ? textOf(content, "text") : "",
        reasoning: content ? textOf(content, "reasoning") : "",
        interrupted: data?.interrupted,
        time: event.time,
        startTime: lastUserTime,
      });
    } else if (event.type === "tool/call") {
      const data = event.data as ToolCallEventData;
      const item: ToolItem = {
        callId: data.callId,
        name: data.name,
        arguments: data.arguments,
        pending: true,
        callTime: event.time,
      };
      tools.set(data.callId, item);
      items.push({ kind: "tool", key: `t-${event.seq}`, tool: item });
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
          });
        }
      }
    }
  }
  return items;
}

export function NativeApp() {
  const [visible, setVisible] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  /** 最近活跃工作区（对齐官方 New Session 语义：新会话落在这里）。 */
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  /** 流式思考文本（reasoning-delta 累积）。 */
  const [liveReasoning, setLiveReasoning] = useState("");
  /** block-start(tool-call) 已宣告但 tool/call 事件未落地的提示态。 */
  const [toolCalling, setToolCalling] = useState(false);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /** 右侧面板折叠态。 */
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  /** 侧栏折叠态（聊天区标题栏常驻按钮收起/展开）。 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  const appendEvent = useCallback((event: SessionEvent) => {
    eventsRef.current = [...eventsRef.current, event];
    if (event.type === "tool/call") setToolCalling(false);
    setItems(foldChatItems(eventsRef.current));
  }, []);

  // 初始化：界面模式 + 会话列表；无活跃工作区时默认取第一个
  useEffect(() => {
    void qingwu
      .getUiMode()
      .then((mode: UiMode) => setVisible(mode === "native"));
    void refreshSessions();
    return qingwu.onUiModeChanged((mode) => setVisible(mode === "native"));
  }, [refreshSessions]);

  // 标题栏左侧融合：native 界面且侧栏展开时，向标题栏暴露侧栏宽度与融合态标记
  // （titlebar.css 据 body class 绘制同色左段，见 .native-sidebar-fused）。
  useEffect(() => {
    const body = document.body;
    if (visible && !sidebarCollapsed) {
      body.classList.add("native-sidebar-fused");
      body.style.setProperty("--native-sidebar-w", `${sidebarPanel.width}px`);
    } else {
      body.classList.remove("native-sidebar-fused");
      body.style.removeProperty("--native-sidebar-w");
    }
    return () => {
      body.classList.remove("native-sidebar-fused");
      body.style.removeProperty("--native-sidebar-w");
    };
  }, [visible, sidebarCollapsed, sidebarPanel.width]);

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
          if (currentIdRef.current === removedId) {
            setCurrentId(null);
          }
        } else if (frame.event === "api-session/status") {
          const sessionId = firstArg as string;
          const isRunning = Boolean(secondArg);
          if (currentIdRef.current === sessionId) setRunning(isRunning);
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === sessionId ? { ...s, running: isRunning } : s,
            ),
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
        return;
      }
      if (frame.type === "upsert" && frame.workspace) {
        setWorkspaces((prev) => {
          const rest = prev.filter(
            (w) => w.workspaceId !== frame.workspace!.workspaceId,
          );
          return [...rest, frame.workspace!];
        });
      } else if (frame.type === "remove" && frame.workspaceId) {
        setWorkspaces((prev) =>
          prev.filter((w) => w.workspaceId !== frame.workspaceId),
        );
      } else if (frame.type === "order" && Array.isArray(frame.workspaceIds)) {
        setWorkspaces((prev) => {
          const byId = new Map(prev.map((w) => [w.workspaceId, w]));
          return frame
            .workspaceIds!.map((id) => byId.get(id))
            .filter((w): w is WorkspaceView => Boolean(w));
        });
      }
      // archived 增量只影响归档列表，当前界面不消费
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
    setToolCalling(false);
    stickBottomRef.current = true;
    setRunning(false);
    if (!currentId) return;

    setLoadingHistory(true);
    let cancelled = false;
    void qingwu
      .dshStreamOpen(Endpoints.sessionFollow, {
        request: {
          address: { kind: "session", sessionId: currentId },
          maxMessages: 100,
        },
      })
      .then((streamId) => {
        if (cancelled) {
          qingwu.dshStreamCancel(streamId);
          return;
        }
        sessionStreamRef.current = streamId;
      });

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
        setItems(foldChatItems(events));
        setLoadingHistory(false);
        return;
      }
      if (frame.type === "event") {
        const event = frame.event;
        if (event.type === "assistant/chunk") {
          const chunk = (event.data as AssistantChunkEventData | null)?.chunk;
          if (!chunk) return;
          if (chunk.type === "text-delta" && typeof chunk.text === "string") {
            setDraft((prev) => prev + chunk.text);
          } else if (
            chunk.type === "reasoning-delta" &&
            typeof chunk.text === "string"
          ) {
            setLiveReasoning((prev) => prev + chunk.text);
          } else if (
            chunk.type === "block-start" &&
            chunk.blockType === "tool-call"
          ) {
            setToolCalling(true);
          }
          return;
        }
        if (event.type === "assistant/message") {
          setDraft("");
          setLiveReasoning("");
          setToolCalling(false);
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
  }, [currentId, appendEvent]);

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

  /** 子代理会话（主对话派生的辅助会话）不在主列表展示。 */
  const visibleSessions = useMemo(
    () => sessions.filter((s) => !s.blank && s.origin !== "subagent"),
    [sessions],
  );

  /** 会话标题：AI 生成/用户命名的 title 投影优先，回退工作目录名。 */
  const sessionTitle = (session: SessionSummary): string => {
    const title = session.projections?.values?.title;
    if (typeof title === "string" && title.trim()) return title;
    if (session.cwd)
      return session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "未命名";
    return "未命名";
  };

  /** 按工作区分组：会话归属来自工作区注册表的 sessionIds 顺序；搜索词先做标题过滤。 */
  const sessionGroups = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const filtered = keyword
      ? visibleSessions.filter((s) =>
          sessionTitle(s).toLowerCase().includes(keyword),
        )
      : visibleSessions;
    const byId = new Map(filtered.map((s) => [s.sessionId, s]));
    const grouped = workspaces
      .map((ws) => ({
        workspaceId: ws.workspaceId,
        title: ws.title,
        sessions: ws.sessionIds
          .map((id) => byId.get(id))
          .filter((s): s is SessionSummary => Boolean(s)),
      }))
      .filter((g) => g.sessions.length > 0);
    const groupedIds = new Set(workspaces.flatMap((ws) => ws.sessionIds));
    const ungrouped = filtered.filter((s) => !groupedIds.has(s.sessionId));
    return { grouped, ungrouped };
  }, [visibleSessions, workspaces, searchText]);

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

  /** 右侧面板数据：todo_write 最新状态 + edit/write 文件聚合。 */
  const panelData = useMemo(() => {
    let todos: TodoEntry[] | null = null;
    const files = new Map<string, FileChangeEntry>();
    for (const event of eventsRef.current) {
      if (event.type !== "tool/call") continue;
      const data = event.data as ToolCallEventData | null;
      if (!data || typeof data.arguments !== "string") continue;
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
    const wsId = workspaceOfSession.get(sessionId);
    if (wsId) setActiveWorkspaceId(wsId);
  };

  /** 在指定项目下落一个新会话：优先复用其空白会话（官方 connectWorkspace 语义）。返回会话 id。 */
  const createSessionIn = async (wsId: string): Promise<string> => {
    const ws = workspaces.find((w) => w.workspaceId === wsId);
    const reusable = ws?.sessionIds
      .map((id) => sessions.find((s) => s.sessionId === id))
      .find((s) => s?.blank && s.origin !== "subagent");
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

  /**
   * 工作区 chip 选择：空态切换新会话落点；会话内把当前会话移动到目标工作区
   * （workspace/insertSessionBefore 省略 beforeSessionId 即追加到末尾）。
   */
  const handleWorkspaceChipPick = (workspaceId: string) => {
    if (!currentId) {
      setActiveWorkspaceId(workspaceId);
      return;
    }
    if (workspaceOfSession.get(currentId) === workspaceId) return;
    void rpc(Endpoints.workspaceInsertSessionBefore, {
      request: { workspaceId, sessionId: currentId },
    })
      .then(() => setActiveWorkspaceId(workspaceId))
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
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
    if (textareaRef.current) textareaRef.current.style.height = "";
    try {
      await rpc(Endpoints.sessionPrompt, {
        request: {
          requestId: crypto.randomUUID(),
          sessionId,
          mode: "queue",
          content: [{ type: "text", text }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInput(text);
    }
  };

  const handleApproval = async (
    approval: PendingApproval,
    outcome: "allowed-once" | "rejected",
  ) => {
    setApprovals((prev) => prev.filter((a) => a.eventId !== approval.eventId));
    await qingwu.dshEventResult(approval.clientId, approval.eventId, {
      kind: "result",
      value: outcome,
    });
  };

  const handleQuestion = async (
    question: PendingQuestion,
    questionId: string,
    label: string,
  ) => {
    await qingwu.dshEventResult(question.clientId, question.eventId, {
      kind: "result",
      value: { answers: [{ id: questionId, selected: [label] }] },
    });
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
    <div className="native-app">
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
              {sessionGroups.grouped.map((group) => {
                const ws = workspaces.find(
                  (w) => w.workspaceId === group.workspaceId,
                );
                if (!ws) return null;
                return (
                  <div
                    key={group.workspaceId}
                    className="native-session-group native-session-group-ws"
                  >
                    <WorkspaceRow
                      workspace={ws}
                      collapsed={collapsedGroups.has(group.workspaceId)}
                      onToggle={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.workspaceId))
                            next.delete(group.workspaceId);
                          else next.add(group.workspaceId);
                          return next;
                        })
                      }
                      onNewSession={() =>
                        void createSessionIn(group.workspaceId).catch((err) =>
                          setError(
                            err instanceof Error ? err.message : String(err),
                          ),
                        )
                      }
                      onRename={(title) =>
                        handleWorkspaceRename(group.workspaceId, title)
                      }
                      onDelete={() => handleWorkspaceDelete(group.workspaceId)}
                    />
                    {!collapsedGroups.has(group.workspaceId) &&
                      group.sessions.map((session) => (
                        <button
                          key={session.sessionId}
                          className={`native-session-item${session.sessionId === currentId ? " active" : ""}`}
                          onClick={() => openSession(session.sessionId)}
                          title={session.cwd ?? session.sessionId}
                        >
                          <span className="native-session-title">
                            {sessionTitle(session)}
                          </span>
                          {session.running && (
                            <span className="native-running-dot" />
                          )}
                        </button>
                      ))}
                  </div>
                );
              })}
              {sessionGroups.ungrouped.length > 0 && (
                <div className="native-session-group">
                  {sessionGroups.grouped.length > 0 && (
                    <GroupHeader
                      title="未分组"
                      collapsed={collapsedGroups.has("未分组")}
                      onToggle={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has("未分组")) next.delete("未分组");
                          else next.add("未分组");
                          return next;
                        })
                      }
                    />
                  )}
                  {!collapsedGroups.has("未分组") &&
                    sessionGroups.ungrouped.map((session) => (
                      <button
                        key={session.sessionId}
                        className={`native-session-item${session.sessionId === currentId ? " active" : ""}`}
                        onClick={() => openSession(session.sessionId)}
                        title={session.cwd ?? session.sessionId}
                      >
                        <span className="native-session-title">
                          {sessionTitle(session)}
                        </span>
                        {session.running && (
                          <span className="native-running-dot" />
                        )}
                      </button>
                    ))}
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

      <main className="native-chat">
        {showGreeting ? (
          <>
            <div className="native-chat-header">
              <div className="native-chat-header-left">
                <button
                  className="native-icon-btn"
                  onClick={() => setSidebarCollapsed((v) => !v)}
                  title={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
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
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M9 4v16" />
                  </svg>
                </button>
              </div>
              <div className="native-chat-header-right">
                <button
                  className="native-icon-btn"
                  onClick={() => setPanelCollapsed((v) => !v)}
                  title={panelCollapsed ? "打开面板" : "收起面板"}
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
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M15 4v16" />
                  </svg>
                </button>
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
                  onInputChange={setInput}
                  onSend={() => void handleSend()}
                  running={false}
                  onStop={() => void handleStop()}
                  textareaRef={textareaRef}
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
                <button
                  className="native-icon-btn"
                  onClick={() => setSidebarCollapsed((v) => !v)}
                  title={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
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
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M9 4v16" />
                  </svg>
                </button>
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
                <button
                  className="native-icon-btn"
                  onClick={() => setPanelCollapsed((v) => !v)}
                  title={panelCollapsed ? "打开面板" : "收起面板"}
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
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M15 4v16" />
                  </svg>
                </button>
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
                {items.map((item) => {
                  if (item.kind === "user") {
                    return (
                      <div key={item.key} className="native-msg user">
                        <div className="native-msg-body">{item.text}</div>
                      </div>
                    );
                  }
                  if (item.kind === "assistant") {
                    if (!item.text && !item.reasoning && !item.interrupted)
                      return null;
                    return (
                      <div key={item.key} className="native-msg assistant">
                        {item.reasoning && (
                          <details className="native-reasoning">
                            <summary>思考过程</summary>
                            <div className="native-reasoning-body">
                              {item.reasoning}
                            </div>
                          </details>
                        )}
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
                              <span>
                                用时{" "}
                                {formatDuration(item.time - item.startTime)}
                              </span>
                            )}
                            <span style={{ flex: 1 }} />
                            <CopyButton text={item.text} />
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <ToolCard
                      key={item.key}
                      tool={item.tool}
                      cwd={currentCwd}
                    />
                  );
                })}
                {liveReasoning && (
                  <details open className="native-reasoning live">
                    <summary>正在思考…</summary>
                    <div className="native-reasoning-body">{liveReasoning}</div>
                  </details>
                )}
                {toolCalling && !liveReasoning && (
                  <div className="native-tool-hint">正在调用工具…</div>
                )}
                {draft && (
                  <div className="native-msg assistant">
                    <div className="native-msg-body">
                      <Markdown text={draft} />
                      <span className="native-cursor" />
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            {(approvals.length > 0 || questions.length > 0) && (
              <div className="native-interactions">
                {approvals.map((approval) => (
                  <div key={approval.eventId} className="native-card approval">
                    <div className="native-card-title">
                      请求授权：{approval.toolName ?? "工具"}
                    </div>
                    {approval.reason && (
                      <div className="native-card-text">{approval.reason}</div>
                    )}
                    <div className="native-card-actions">
                      <button
                        className="primary"
                        onClick={() =>
                          void handleApproval(approval, "allowed-once")
                        }
                      >
                        允许一次
                      </button>
                      <button
                        onClick={() =>
                          void handleApproval(approval, "rejected")
                        }
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
                {questions.map((question) =>
                  (question.questions ?? []).map((q) => (
                    <div
                      key={`${question.eventId}-${q.id}`}
                      className="native-card question"
                    >
                      <div className="native-card-title">{q.question}</div>
                      {q.detail && (
                        <div className="native-card-text">{q.detail}</div>
                      )}
                      <div className="native-card-actions">
                        {(q.options ?? []).map((option) => (
                          <button
                            key={option.label}
                            onClick={() =>
                              void handleQuestion(question, q.id, option.label)
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )),
                )}
              </div>
            )}

            <div className="native-composer">
              <div className="native-composer-stack">
                <WorkspaceChip
                  workspaces={workspaces}
                  currentId={chipWorkspaceId}
                  fallbackLabel="未分组"
                  onPick={handleWorkspaceChipPick}
                  onAdd={() => void handleAddWorkspace()}
                />
                <Composer
                  input={input}
                  onInputChange={setInput}
                  onSend={() => void handleSend()}
                  running={running}
                  onStop={() => void handleStop()}
                  textareaRef={textareaRef}
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
      />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
