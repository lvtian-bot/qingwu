/**
 * dsh /api 协议的最小类型对齐（阶段 1 手写子集）。
 * 来源：@deepseek-ai/dsh-host-apiproxy ./api 与 @deepseek-ai/dsh-session/types
 * 的 0.1.1-rc.2 声明。后续阶段改为直接依赖官方约定层（见 TODO 契约闸门项），
 * 字段以官方 .d.ts 为准；此处仅声明自研界面消费的字段，判别值保持开放
 * （unknown type 一律忽略渲染，协议是 merge-extensible 的）。
 */

// ---------- 消息与内容块 ----------

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ReasoningBlock {
  type: 'reasoning';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool-call';
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResultBlock {
  type: 'tool-result';
  toolCallId: string;
  content: unknown[];
  isError?: boolean;
}

export type ContentBlock = TextBlock | ReasoningBlock | { type: string } & Record<string, unknown>;

export interface UserMessage {
  id: string;
  role: 'user';
  content: ContentBlock[];
  source: { kind: string };
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: ContentBlock[];
  source: { kind: 'model'; provider: string; model: string };
}

export interface ToolResultMessage {
  id: string;
  role: 'user';
  content: [ToolResultBlock];
  source: { kind: 'tool'; callId: string };
}

// ---------- 会话事件 ----------

export interface SessionEventEnvelope {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}

export interface UserMessageEvent extends SessionEventEnvelope {
  type: 'user/message';
  data: UserMessage;
}

export interface AssistantMessageEvent extends SessionEventEnvelope {
  type: 'assistant/message';
  data: {
    turn: number;
    step: number;
    message: AssistantMessage;
    usage?: unknown;
    interrupted?: true;
  };
}

export interface ToolCallEvent extends SessionEventEnvelope {
  type: 'tool/call';
  data: { turn: number; step: number; callId: string; name: string; arguments: string };
}

export interface ToolResultEvent extends SessionEventEnvelope {
  type: 'tool/result';
  data: {
    turn: number;
    step: number;
    message: ToolResultMessage;
    error?: { name: string; code: string };
  };
}

export interface AssistantChunkEvent extends SessionEventEnvelope {
  type: 'assistant/chunk';
  data: {
    turn: number;
    step: number;
    chunk:
      | { type: 'block-start'; index: number; blockType: string }
      | { type: 'text-delta'; index: number; text: string }
      | { type: 'reasoning-delta'; index: number; text: string }
      | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
      | { type: 'block-end'; index: number; block: unknown }
      | { type: 'usage'; usage: unknown }
      | { type: 'finish'; reason: unknown };
  };
}

export type SessionEvent =
  | SessionEventEnvelope
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | AssistantChunkEvent;

// ---------- mux 流帧 ----------

export interface ApprovalRequestedFrame {
  type: 'approval/requested';
  sessionId: string;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

export interface ApprovalResolvedFrame {
  type: 'approval/resolved';
  sessionId: string;
  approvalId: string;
  outcome: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionRequestedFrame {
  type: 'question/requested';
  sessionId: string;
  questions: {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: QuestionOption[];
    multiSelect?: boolean;
  }[];
}

export interface QuestionResolvedFrame {
  type: 'question/resolved';
  sessionId: string;
  questionRpcId: string;
  outcome: 'answered' | 'cancelled';
}

export type MuxFrame =
  | { type: 'session/event'; sessionId: string; event: SessionEvent; view?: unknown }
  | { type: 'session/subscribed'; sessionId: string; lastSeq: number }
  | ApprovalRequestedFrame
  | ApprovalResolvedFrame
  | QuestionRequestedFrame
  | QuestionResolvedFrame
  | { type: 'session/queue'; sessionId: string; items: unknown[] }
  | { type: 'session/projection'; sessionId: string; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: { code: string; message: string } };

// ---------- host 流帧 ----------

export type HostFrame =
  | { type: 'host/session-added'; sessionId: string; blank: boolean; cwd?: string }
  | { type: 'host/session-removed'; sessionId: string }
  | { type: 'host/session-status'; sessionId: string; running: boolean }
  | { type: 'host/agent-error'; sessionId: string; message: string }
  | { type: 'host/workspace-changed'; workspace: unknown }
  | { type: 'host/workspace-removed'; workspaceId: string }
  | { type: 'host/workspace-order-changed'; workspaceIds: string[] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: string[] }
  | { type: 'stream/error'; error: { code: string; message: string } };

// ---------- RPC 载荷 ----------

export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd?: string;
  origin?: string;
  /** 会话列表投影基线：title 为 AI 自动生成或用户重命名的标题。 */
  projections?: {
    asOfSeq: number;
    values?: { title?: string | null; [key: string]: unknown };
  };
}

export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
}

export interface HistoryEntry {
  event: SessionEvent;
  view?: unknown;
}

/** 审批回应载荷（ClientResponse result.value）。 */
export interface ApprovalResponsePayload {
  sessionId: string;
  approvalId: string;
  outcome: 'allowed-once' | 'rejected';
}

/** 问答回应载荷（ClientResponse result.value）。 */
export interface QuestionResponsePayload {
  sessionId: string;
  answer: { answers: { id: string; selected: string[]; custom?: string }[] };
}
