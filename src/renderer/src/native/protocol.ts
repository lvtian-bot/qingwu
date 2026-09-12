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
  sessionAttachment: 'session/attachment',
  sessionCancel: 'session/cancel',
  sessionUpdateQueue: 'session/updateQueue',
  sessionPage: 'session/page',
  sessionFollow: 'session/follow',
  sessionModelCatalog: 'session/modelCatalog',
  sessionSelectModel: 'session/selectModel',
  sessionRename: 'session/rename',
  commandsExecute: 'commands/execute',
  settingsDescribe: 'settings/describe',
  settingsMutate: 'settings/mutate',
  workspaceFollow: 'workspace/follow',
  workspaceCreate: 'workspace/create',
  workspaceRename: 'workspace/rename',
  workspaceDelete: 'workspace/delete',
  workspaceArchiveSession: 'workspace/archiveSession',
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

// ---------- 会话投影：用量与上下文占用（dsh-token-meter） ----------

/**
 * 全量日志累计的提供方用量。四个桶互不重叠：推理 token 已含在 outputTokens 内，
 * 不另计。官方 `turnUsage` 展示用的就是同一份数据的 last 采样。
 */
export interface TokenUsageProjection {
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * 下一次请求的上下文占用：最近一次提供方采样的 prompt 大小，加上此后表面的
 * 启发式增减。字段各自 last-wins（切模型时可能短时出现「新容量 + 旧压力」），
 * 官方明确这是展示参考值、不是计费或准入依据。
 */
export interface ContextPressureProjection {
  /** 最近一次请求的 prompt 大小（不含本轮输出）。提供方报告 usage 前缺省。 */
  pressureTokens?: number;
  /** 下一次请求 prompt 的预估：pressureTokens + 采样后表面的净增减。 */
  projectedTokens?: number;
  /** 最近记录的路线容量；提供方未声明时缺省，缺省即不显示占用。 */
  contextWindow?: number;
}

/** 下一次请求的启发式构成（固定密度估算，三项之和与 projectedTokens 不同口径）。 */
export interface ContextBreakdownProjection {
  systemTokens: number;
  toolsTokens: number;
  messageTokens: number;
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

export interface ImageAttachmentRef {
  attachmentId: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  bytes: number;
  width: number;
  height: number;
  name?: string;
  originalDimensions?: { width: number; height: number };
}

export interface ImageBlock {
  type: 'image';
  attachment: ImageAttachmentRef;
}

export interface SessionAttachmentResult {
  attachment: ImageAttachmentRef;
  data: string;
}

export type ContentBlock = TextBlock | ReasoningBlock | ImageBlock | { type: string } & Record<string, unknown>;

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
  turn: number;
  step: number;
  message?: { content?: ContentBlock[] };
  interrupted?: true;
}

export interface ToolCallEventData {
  turn: number;
  step: number;
  callId: string;
  name: string;
  arguments: string;
}

export interface ToolResultEventData {
  message?: { content?: { type: string; toolCallId: string; content?: unknown[]; isError?: boolean }[] };
  error?: { name: string; code: string };
}

/** 队列里的一条待发送消息（journal 事件 agent/inbox/spliced 的 inserted 元素）。 */
export interface InboxMessage {
  id?: string;
  content?: ContentBlock[];
  source?: { kind?: string; rpcId?: string };
}

/**
 * agent/inbox/spliced：driver 拥有的 inbox 队列变更（durable）。
 * target 区分「下一轮排队」与「下一步插话」，语义与 Array.prototype.splice 一致。
 */
export interface InboxSplicedEventData {
  target: 'next-turn' | 'next-step';
  start: number;
  removedCount?: number;
  inserted?: InboxMessage[];
}

/** session/updateQueue 的队列操作（edit 只接受纯文本内容）。 */
export type QueueAction =
  | { kind: 'edit'; content: ContentBlock[] }
  | { kind: 'remove' }
  | { kind: 'steer' };

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
  /** 声明 assistantStream 后必然带回的在飞 attempt 基线（revision + 已产出的压实增量）。 */
  assistantStream?: AssistantStreamBaseline;
}

export interface SessionFollowEventItem {
  type: 'event';
  event: SessionEvent;
}

/**
 * 过程内 live 帧：0.1.5 起「正在输出的文本 / 正在思考的推理」只走这条路，
 * 请求 follow 时必须声明 `assistantStream: true`，且帧 revision 逐帧 +1。
 */
export interface AssistantStreamFrameItem {
  type: 'assistant-stream';
  frame: AssistantStreamFrame;
}

export type SessionFollowFrame =
  | SessionFollowSnapshot
  | SessionFollowEventItem
  | AssistantStreamFrameItem;

// ---------- assistant 过程内流（0.1.5 起替代 durable assistant/chunk） ----------

/** live 帧携带的块，与 assistant/chunk 的块词汇同形（text-delta / reasoning-delta…）。 */
export type AssistantBlockDelta = AssistantChunkEventData['chunk'];

/**
 * 重连基线里的压实记录：把同一块的连续增量按 dt 压成一段，重放即还原在飞文本。
 * （对应官方 ClientAssistantStream 的 expandAssistantStream 语义。）
 */
export type AssistantStreamRecord =
  | { type: 'text-chunks'; time0: number; index: number; dt: number[]; texts: string[] }
  | { type: 'reasoning-chunks'; time0: number; index: number; dt: number[]; texts: string[] }
  | {
      type: 'tool-call-chunks';
      time0: number;
      index: number;
      dt: number[];
      id: string;
      name?: string;
      args: string[];
    }
  | { type: 'chunk'; time: number; chunk: AssistantBlockDelta };

/** 开场快照里的在飞 attempt（stream 为该 attempt 至今产出的压实增量）。 */
export interface AssistantStreamAttempt {
  attemptId: string;
  startedAfterSeq: number;
  turn: number;
  step: number;
  nextIndex: number;
  stream: AssistantStreamRecord[];
}

export interface AssistantStreamBaseline {
  revision: number;
  activeAttempt?: AssistantStreamAttempt;
}

/** 过程内 live 帧：start 开启一次 attempt，chunk 增量，end 收束（committed 或 abandoned）。 */
export type AssistantStreamFrame =
  | {
      type: 'start';
      attemptId: string;
      revision: number;
      startedAfterSeq: number;
      turn: number;
      step: number;
    }
  | {
      type: 'chunk';
      attemptId: string;
      revision: number;
      index: number;
      time: number;
      chunk: AssistantBlockDelta;
    }
  | {
      type: 'end';
      attemptId: string;
      revision: number;
      index: number;
      outcome:
        | { kind: 'committed'; eventType: string; seq: number }
        | { kind: 'abandoned' };
    };

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

/**
 * 瀑布请求（审批/问答）：request 为投影后的 JSON 安全字段。
 *
 * `agentId` 是发起该请求的 Agent 身份。引擎里 Agent id 恒等于 Session id
 * （dsh-agent 装配时就断言 `id === session.id`，客户端作用域也按同一约定把
 * Agent 身份当会话路由标签），所以它就是**归属会话 id**：待处理项必须按它
 * 归位，否则同一张卡片会在所有会话里都显示。
 */
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
    /** 呈现意图：plan-review 表示 detail 是待审批的计划，approve 指向批准它的选项 label。 */
    intent?: { kind: string; approve?: string };
  }[];
}

/** 单题答案：selected 为选中的选项 label，custom 为自由文本（单选题两者互斥）。 */
export interface UserQuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

// ---------- 会话摘要（session/list） ----------

export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  origin?: string;
  /** 父会话：只有子代理会话带（青梧界面不展示子代理会话，其待处理项归到这条上）。 */
  parentSessionId?: string;
  cwd?: string;
  projections?: {
    asOfSeq: number;
    values?: {
      title?: string | null;
      modelSelection?: ModelSelectionProjection;
      permissions?: PermissionSelect;
      tokenUsage?: TokenUsageProjection;
      contextPressure?: ContextPressureProjection;
      contextBreakdown?: ContextBreakdownProjection;
      [key: string]: unknown;
    };
  };
}
