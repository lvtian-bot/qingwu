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
  workspaceFollow: 'workspace/follow',
  workspaceCreate: 'workspace/create',
  directoryPickerPick: 'directoryPicker/pick',
  eventsResult: '$events/result',
} as const;

// ---------- 会话事件（journal 原始事件，0.1.1 词汇保持兼容） ----------

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = TextBlock | { type: string } & Record<string, unknown>;

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
    | { type: 'text-delta'; index: number; text: string }
    | { type: string } & Record<string, unknown>;
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
    values?: { title?: string | null; [key: string]: unknown };
  };
}
