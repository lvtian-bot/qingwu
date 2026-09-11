/**
 * dsh 0.1.2 /api 协议的最小类型对齐（自研界面消费子集）。
 * 来源：@deepseek-ai/dsh-api-session-controller / dsh-api-workspace-controller /
 * dsh-user-approval / dsh-user-questions 的 0.1.2-rc.1 声明，以及
 * dsh-api-gateway 的 remote.mux 流协议。字段以官方 .d.ts 为准；未识别字段
 * 一律忽略渲染（协议是 merge-extensible 的）。
 */

// ---------- 一元 RPC endpoint ----------

/** 自研界面消费的一元 RPC endpoint（wire 名为斜杠分隔）。 */
export const Endpoints = {
  sessionList: 'session/list',
  sessionCreate: 'session/create',
  sessionPrompt: 'session/prompt',
  sessionCancel: 'session/cancel',
  sessionPage: 'session/page',
  sessionFollow: 'session/follow',
  sessionModelCatalog: 'session/modelCatalog',
  sessionSelectModel: 'session/selectModel',
  commandsExecute: 'commands/execute',
  settingsDescribe: 'settings/describe',
  settingsMutate: 'settings/mutate',
  workspaceFollow: 'workspace/follow',
  workspaceCreate: 'workspace/create',
  workspaceRename: 'workspace/rename',
  workspaceDelete: 'workspace/delete',
  workspaceInsertSessionBefore: 'workspace/insertSessionBefore',
  directoryPickerPick: 'directoryPicker/pick',
  eventsResult: '$events/result',
} as const;

// ---------- 模型目录与选择（0.1.2 wire 实测形状） ----------

/** 一次模型选择意图：provider + model + 可选推理强度。 */
export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 推理强度档位（off/low/high/max…，id 稳定、name 面向展示）。 */
export interface ModelReasoningEffort {
  id: string;
  name: string;
  description?: string;
}

export interface ModelReasoning {
  efforts: ModelReasoningEffort[];
  defaultEffort?: string;
}

export interface ModelCatalogModel {
  id: string;
  name: string;
  description?: string;
  reasoning?: ModelReasoning;
}

export interface ModelProviderGroup {
  id: string;
  name: string;
  models: ModelCatalogModel[];
}

/** session/modelCatalog 返回：provider 分组 + 未配置会话时的默认选择。 */
export interface ModelCatalog {
  default?: ModelSelection;
  routableProviders?: string[];
  groups: ModelProviderGroup[];
}

/** 会话投影 modelSelection：next = pending ?? lastUsed（生效/待生效选择）。 */
export interface ModelSelectionProjection {
  lastUsed: ModelSelection | null;
  next: ModelSelection | null;
}

/** 权限预设选项（value 为 read-only / workspace-write / danger-full-access…）。 */
export interface PresetOption {
  value: string;
  name: string;
  description?: string;
}

/** 会话投影 permissions：可切换预设 + 当前生效值（custom 表示旋钮组合无预设）。 */
export interface PermissionSelect {
  options: PresetOption[];
  currentValue: string;
}

/** commands/execute 返回：斜杠命令在宿主的执行结果。 */
export interface CommandExecution {
  commandId: string;
  result: { kind: 'success'; text?: string } | { kind: 'error'; text: string };
}

// ---------- 设置命名空间（settings/describe、settings/mutate） ----------

/** 一次路径寻址的设置写入：set 写入并创建中间对象。 */
export interface SettingsPathOp {
  op: 'set';
  path: string[];
  value: unknown;
}

/** 单个设置命名空间的 wire 视图（值为脱敏后的 JSON）。 */
export interface SettingsNamespaceView {
  /** 命名空间键（permission、llm-deepseek…）。 */
  ns: string;
  /** schemastery schema 序列化包络（nodeAtPath 的原始形态）。 */
  schema: unknown;
  /** 解析后的值（schema 默认 → 组合 base → 用户层）。 */
  value: Record<string, unknown>;
  applies?: 'live' | 'restart';
  /** 读取时的用户段修订号，写入须回传以免覆盖并发修改。 */
  revision: number;
}

/** settings/describe 返回：部署写入能力 + 全部命名空间视图。 */
export interface SettingsDescribeValue {
  /** provider 是否接受写入；false 时禁用全部写入控件。 */
  writable: boolean;
  namespaces: SettingsNamespaceView[];
}

// ---------- 会话事件（journal 原始事件，0.1.1 词汇保持兼容） ----------

export interface TextBlock {
  type: 'text';
  text: string;
}

/** 思考块：文本同样落在 text 字段。 */
export interface ReasoningBlock {
  type: 'reasoning';
  text: string;
}

export type ContentBlock = TextBlock | ReasoningBlock | { type: string } & Record<string, unknown>;

/** journal 原始事件（SessionWireEvent）：type/seq/time/data，识别不了的忽略。 */
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}

export interface UserMessageData {
  source?: { kind: string };
  content?: ContentBlock[];
}

export interface AssistantMessageData {
  message?: { content?: ContentBlock[] };
  interrupted?: true;
}

export interface ToolCallEventData {
  callId: string;
  name: string;
  arguments: string;
}

export interface ToolResultEventData {
  message?: { content?: { type: string; toolCallId: string; content?: unknown[]; isError?: boolean }[] };
  error?: { name: string; code: string };
}

export interface AssistantChunkEventData {
  chunk:
    | { type: 'block-start'; index: number; blockType: 'reasoning' | 'text' | 'tool-call' | string }
    | { type: 'block-end'; index: number; block?: Record<string, unknown> }
    | { type: 'text-delta'; index: number; text: string }
    | { type: 'reasoning-delta'; index: number; text: string }
    | {
        type: 'tool-call-delta';
        index: number;
        id?: string;
        name?: string;
        argumentsDelta?: string;
      }
    | { type: string } & Record<string, unknown>;
}

// ---------- 工具调用参数（wire 实测结构，未知工具回退通用展示） ----------

export interface PwshArgs {
  command: string;
  description?: string;
}

export interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface PatternArgs {
  pattern: string;
  path?: string;
}

export interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
}

export interface WriteArgs {
  file_path: string;
  content?: string;
}

export interface TodoWriteArgs {
  todos: { content: string; status: string }[];
}

// ---------- session/follow 日志流 ----------

export interface SessionHistoryRecord {
  type: 'event' | 'chunks' | string;
  event: SessionEvent;
}

/** follow 开场帧：完整开场窗口 + 投影基线，后续为增量事件条目。 */
export interface SessionFollowSnapshot {
  type: 'snapshot';
  cursor: number;
  records: SessionHistoryRecord[];
  hasMore: boolean;
  projections?: { asOfSeq: number; values?: Record<string, unknown> };
}

export interface SessionFollowEventItem {
  type: 'event';
  event: SessionEvent;
}

export type SessionFollowFrame = SessionFollowSnapshot | SessionFollowEventItem;

// ---------- workspace/follow 工作区流 ----------

export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
}

export interface WorkspaceFollowFrame {
  type: 'baseline' | 'upsert' | 'remove' | 'order' | 'archived' | string;
  value?: { items?: WorkspaceView[]; archivedSessionIds?: string[] };
  workspace?: WorkspaceView;
  workspaceId?: string;
  workspaceIds?: string[];
  archivedSessionIds?: string[];
}

// ---------- $events 转发事件流 ----------

/** 开场帧，绑定本代事件流的 clientId（瀑布回执必需）。 */
export interface RemoteEventReadyFrame {
  type: 'ready';
  clientId: string;
  host?: { home?: string };
}

export interface RemoteEventEmitFrame {
  type: 'emit';
  event: string;
  args: unknown[];
}

/** 瀑布请求（审批/问答）：request 为投影后的 JSON 安全字段。 */
export interface RemoteEventInvocationFrame {
  type: 'waterfall';
  event: string;
  eventId: string;
  agentId: string;
  request: Record<string, unknown>;
}

export interface RemoteEventCancellationFrame {
  type: 'cancel';
  eventId: string;
}

export type RemoteEventFrame =
  | RemoteEventReadyFrame
  | RemoteEventEmitFrame
  | RemoteEventInvocationFrame
  | RemoteEventCancellationFrame;

/** 审批瀑布 request（ApprovalRequestEvent 投影）。 */
export interface ApprovalRequestPayload {
  toolName?: string;
  callId?: string;
  reason?: string;
}

/** 问答瀑布 request（AskUserQuestionRequestEvent 投影）。 */
export interface UserQuestionsRequestPayload {
  questions?: {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: { label: string; description?: string }[];
    multiSelect?: boolean;
  }[];
}

// ---------- 会话摘要（session/list） ----------

export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  origin?: string;
  cwd?: string;
  projections?: {
    asOfSeq: number;
    values?: {
      title?: string | null;
      modelSelection?: ModelSelectionProjection;
      permissions?: PermissionSelect;
      [key: string]: unknown;
    };
  };
}
