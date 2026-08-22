import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApprovalRequestedFrame,
  AssistantChunkEvent,
  AssistantMessageEvent,
  HistoryEntry,
  HostFrame,
  MuxFrame,
  QuestionRequestedFrame,
  SessionEvent,
  SessionSummary,
  ToolCallEvent,
  ToolResultEvent,
  UserMessageEvent,
  WorkspaceView,
} from './protocol';
import type { DshRpcResult, DshStreamFrame, UiMode } from '../../../shared/types';
import './native.css';

const qingwu = window.qingwu;

async function rpc<T>(method: string, payload: unknown): Promise<T> {
  const result = (await qingwu.dshCall(method, payload)) as DshRpcResult<T> | undefined;
  if (!result || typeof result.ok !== 'boolean') {
    throw new Error(`${method} 返回非法结果`);
  }
  if (!result.ok) {
    throw new Error(
      `${method} 失败: ${result.error?.code ?? 'unknown'} ${result.error?.message ?? ''}`
    );
  }
  return result.value;
}

/** 从消息内容块中提取可展示文本（忽略非文本块）。 */
function textOf(content: unknown[]): string {
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
    )
    .map((block) => block.text)
    .join('');
}

interface PendingApproval extends ApprovalRequestedFrame {
  rpcId: string;
}

interface PendingQuestion extends QuestionRequestedFrame {
  rpcId: string;
}

/** 工具调用条目：call 事件与 result 事件按 callId 配对。 */
interface ToolItem {
  callId: string;
  name: string;
  arguments: string;
  resultText?: string;
  isError?: boolean;
  pending: boolean;
}

/** 会话内渲染条目。 */
type ChatItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string; interrupted?: boolean }
  | { kind: 'tool'; key: string; tool: ToolItem };

function foldChatItems(events: SessionEvent[]): ChatItem[] {
  const tools = new Map<string, ToolItem>();
  const items: ChatItem[] = [];

  for (const event of events) {
    if (event.type === 'user/message') {
      const data = (event as UserMessageEvent).data;
      if (data?.source?.kind === 'user') {
        items.push({ kind: 'user', key: `u-${event.seq}`, text: textOf(data.content) });
      }
    } else if (event.type === 'assistant/message') {
      const data = (event as AssistantMessageEvent).data;
      items.push({
        kind: 'assistant',
        key: `a-${event.seq}`,
        text: textOf(data.message.content),
        interrupted: data.interrupted,
      });
    } else if (event.type === 'tool/call') {
      const data = (event as ToolCallEvent).data;
      const item: ToolItem = {
        callId: data.callId,
        name: data.name,
        arguments: data.arguments,
        pending: true,
      };
      tools.set(data.callId, item);
      items.push({ kind: 'tool', key: `t-${event.seq}`, tool: item });
    } else if (event.type === 'tool/result') {
      const data = (event as ToolResultEvent).data;
      const block = data.message?.content?.[0];
      if (block && block.type === 'tool-result') {
        const target = tools.get(block.toolCallId);
        const resultText = Array.isArray(block.content)
          ? textOf(block.content as { type: string; text?: string }[])
          : '';
        if (target) {
          target.pending = false;
          target.resultText = resultText || (data.error ? `${data.error.name}: ${data.error.code}` : '');
          target.isError = Boolean(data.error) || Boolean(block.isError);
        } else {
          items.push({
            kind: 'tool',
            key: `t-${event.seq}`,
            tool: {
              callId: block.toolCallId,
              name: 'tool',
              arguments: '',
              resultText,
              isError: Boolean(block.isError),
              pending: false,
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
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const eventsRef = useRef<SessionEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const [listValue, wsValue] = await Promise.all([
        rpc<{ items: SessionSummary[] }>('session.list', {}),
        rpc<{ items: WorkspaceView[] }>('workspace.list', {}),
      ]);
      setSessions(listValue.items);
      setWorkspaces(wsValue.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    setCurrentId(sessionId);
    setLoadingHistory(true);
    try {
      const value = await rpc<{ events: HistoryEntry[] }>('session.history', {
        sessionId,
        maxMessages: 100,
      });
      eventsRef.current = value.events.map((entry) => entry.event);
      setItems(foldChatItems(eventsRef.current));
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const appendEvent = useCallback((event: SessionEvent) => {
    eventsRef.current = [...eventsRef.current, event];
    setItems(foldChatItems(eventsRef.current));
  }, []);

  // 初始化：界面模式 + 会话列表；无活跃工作区时默认取第一个
  useEffect(() => {
    void qingwu.getUiMode().then((mode: UiMode) => setVisible(mode === 'native'));
    void refreshSessions();
    return qingwu.onUiModeChanged((mode) => setVisible(mode === 'native'));
  }, [refreshSessions]);

  useEffect(() => {
    if (workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].workspaceId);
    }
  }, [workspaces, activeWorkspaceId]);

  // 事件流分发
  useEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshSessions(), 300);
    };

    const unsubscribe = qingwu.onDshEvent(({ stream, rpcId, payload }: DshStreamFrame) => {
      if (stream === 'host') {
        const frame = payload as HostFrame;
        if (
          frame.type === 'host/session-added' ||
          frame.type === 'host/session-removed' ||
          frame.type === 'host/workspace-changed' ||
          frame.type === 'host/workspace-removed' ||
          frame.type === 'host/workspace-order-changed'
        ) {
          scheduleRefresh();
        } else if (frame.type === 'host/session-status') {
          if (frame.sessionId === currentId) setRunning(frame.running);
          scheduleRefresh();
        } else if (frame.type === 'host/agent-error' && frame.sessionId === currentId) {
          setError(frame.message);
        }
        return;
      }

      const frame = payload as MuxFrame;
      switch (frame.type) {
        case 'session/event': {
          if (frame.sessionId !== currentId) return;
          const event = frame.event;
          if (event.type === 'assistant/chunk') {
            const chunk = (event as AssistantChunkEvent).data.chunk;
            if (chunk.type === 'text-delta') {
              setDraft((prev) => prev + chunk.text);
            }
          } else if (event.type === 'assistant/message') {
            setDraft('');
            appendEvent(event);
          } else {
            appendEvent(event);
          }
          break;
        }
        case 'approval/requested':
          setApprovals((prev) => [...prev, { ...(frame as ApprovalRequestedFrame), rpcId }]);
          break;
        case 'approval/resolved':
          setApprovals((prev) => prev.filter((a) => a.approvalId !== frame.approvalId));
          break;
        case 'question/requested':
          setQuestions((prev) => [...prev, { ...(frame as QuestionRequestedFrame), rpcId }]);
          break;
        case 'question/resolved':
          setQuestions((prev) => prev.filter((q) => q.rpcId !== frame.questionRpcId));
          break;
        case 'session/projection': {
          // title 投影实时更新会话列表（seq 高者胜，与列表基线 asOfSeq 比较）
          const title = frame.value;
          if (frame.key === 'title' && typeof title === 'string') {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.sessionId !== frame.sessionId) return s;
                if ((s.projections?.asOfSeq ?? -1) >= frame.seq) return s;
                return {
                  ...s,
                  projections: {
                    asOfSeq: frame.seq,
                    values: { ...s.projections?.values, title },
                  },
                };
              })
            );
          }
          break;
        }
        case 'stream/error':
          setError(frame.error.message);
          break;
        default:
          break;
      }
    });
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [currentId, appendEvent, refreshSessions]);

  // 会话切换时加载历史（loadedId 防止重复加载）
  useEffect(() => {
    if (currentId && currentId !== loadedId) {
      setLoadedId(currentId);
      void loadSession(currentId);
    }
  }, [currentId, loadedId, loadSession]);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [items, draft, approvals, questions]);

  /** 子代理会话（主对话派生的辅助会话）不在主列表展示。 */
  const visibleSessions = useMemo(
    () => sessions.filter((s) => !s.blank && s.origin !== 'subagent'),
    [sessions]
  );

  /** 按工作区（项目）分组：会话归属来自工作区注册表的 sessionIds 顺序。 */
  const sessionGroups = useMemo(() => {
    const byId = new Map(visibleSessions.map((s) => [s.sessionId, s]));
    const grouped = workspaces
      .map((ws) => ({
        title: ws.title,
        sessions: ws.sessionIds
          .map((id) => byId.get(id))
          .filter((s): s is SessionSummary => Boolean(s)),
      }))
      .filter((g) => g.sessions.length > 0);
    const groupedIds = new Set(workspaces.flatMap((ws) => ws.sessionIds));
    const ungrouped = visibleSessions.filter((s) => !groupedIds.has(s.sessionId));
    return { grouped, ungrouped };
  }, [visibleSessions, workspaces]);

  /** 会话 → 所属工作区映射（点击会话时更新活跃工作区）。 */
  const workspaceOfSession = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) {
      for (const id of ws.sessionIds) map.set(id, ws.workspaceId);
    }
    return map;
  }, [workspaces]);

  const openSession = (sessionId: string) => {
    setCurrentId(sessionId);
    const wsId = workspaceOfSession.get(sessionId);
    if (wsId) setActiveWorkspaceId(wsId);
  };

  /** 会话标题：AI 生成/用户命名的 title 投影优先，回退工作目录名。 */
  const sessionTitle = (session: SessionSummary): string => {
    const title = session.projections?.values?.title;
    if (typeof title === 'string' && title.trim()) return title;
    if (session.cwd) return session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? '未命名';
    return '未命名';
  };

  /** 在指定项目下落一个新会话：优先复用其空白会话（官方 connectWorkspace 语义）。 */
  const createSessionIn = async (wsId: string) => {
    const ws = workspaces.find((w) => w.workspaceId === wsId);
    const reusable = ws?.sessionIds
      .map((id) => sessions.find((s) => s.sessionId === id))
      .find((s) => s?.blank && s.origin !== 'subagent');
    if (reusable) {
      setLoadedId(null);
      setCurrentId(reusable.sessionId);
      return;
    }
    const value = await rpc<{ sessionId: string }>('session.create', { workspaceId: wsId });
    await refreshSessions();
    setLoadedId(null);
    setCurrentId(value.sessionId);
  };

  /**
   * 新会话：对齐官方 startSession 语义——落在当前/最近活跃项目并复用空白会话；
   * 零项目时不建会话，引导添加第一个项目（官方为空白 New Session 页）。
   */
  const handleNewSession = async () => {
    if (!activeWorkspaceId) {
      await handleAddWorkspace();
      return;
    }
    try {
      await createSessionIn(activeWorkspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 添加项目：独立的目录选择动作；添加后立即在其下开新会话。 */
  const handleAddWorkspace = async () => {
    try {
      const picked = await rpc<{ path: string | null }>('host.pickDirectory', {});
      if (!picked.path) return;
      const created = await rpc<{ workspace: WorkspaceView }>('workspace.create', {
        path: picked.path,
      });
      setActiveWorkspaceId(created.workspace.workspaceId);
      await refreshSessions();
      await createSessionIn(created.workspace.workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !currentId) return;
    setInput('');
    try {
      await rpc('session.prompt', {
        sessionId: currentId,
        mode: 'queue',
        content: [{ type: 'text', text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInput(text);
    }
  };

  const handleApproval = async (approval: PendingApproval, outcome: 'allowed-once' | 'rejected') => {
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approval.approvalId));
    await qingwu.dshRespond(approval.rpcId, {
      ok: true,
      value: { sessionId: approval.sessionId, approvalId: approval.approvalId, outcome },
    });
  };

  const handleQuestion = async (question: PendingQuestion, questionId: string, label: string) => {
    await qingwu.dshRespond(question.rpcId, {
      ok: true,
      value: {
        sessionId: question.sessionId,
        answer: { answers: [{ id: questionId, selected: [label] }] },
      },
    });
  };

  const handleStop = async () => {
    if (!currentId) return;
    try {
      await rpc('session.cancel', { sessionId: currentId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!visible) return null;

  return (
    <div className="native-app">
      <aside className="native-sidebar">
        <div className="native-sidebar-actions">
          <button className="native-new-session" onClick={() => void handleNewSession()}>
            ＋ 新会话
          </button>
          <button className="native-add-workspace" onClick={() => void handleAddWorkspace()}>
            ＋ 项目
          </button>
        </div>
        <div className="native-session-list">
          {sessionGroups.grouped.map((group) => (
            <div key={group.title} className="native-session-group">
              <div className="native-group-title">{group.title}</div>
              {group.sessions.map((session) => (
                <button
                  key={session.sessionId}
                  className={`native-session-item${session.sessionId === currentId ? ' active' : ''}`}
                  onClick={() => openSession(session.sessionId)}
                  title={session.cwd ?? session.sessionId}
                >
                  <span className="native-session-title">{sessionTitle(session)}</span>
                  {session.running && <span className="native-running-dot" />}
                </button>
              ))}
            </div>
          ))}
          {sessionGroups.ungrouped.length > 0 && (
            <div className="native-session-group">
              {sessionGroups.grouped.length > 0 && <div className="native-group-title">未分组</div>}
              {sessionGroups.ungrouped.map((session) => (
                <button
                  key={session.sessionId}
                  className={`native-session-item${session.sessionId === currentId ? ' active' : ''}`}
                  onClick={() => openSession(session.sessionId)}
                  title={session.cwd ?? session.sessionId}
                >
                  <span className="native-session-title">{sessionTitle(session)}</span>
                  {session.running && <span className="native-running-dot" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="native-chat">
        {!currentId ? (
          <div className="native-empty">选择或新建一个会话开始</div>
        ) : (
          <>
            <div className="native-messages">
              {loadingHistory && <div className="native-hint">正在加载会话历史…</div>}
              {items.map((item) => {
                if (item.kind === 'user') {
                  return (
                    <div key={item.key} className="native-msg user">
                      <div className="native-msg-role">你</div>
                      <div className="native-msg-body">{item.text}</div>
                    </div>
                  );
                }
                if (item.kind === 'assistant') {
                  return (
                    <div key={item.key} className="native-msg assistant">
                      <div className="native-msg-role">青梧</div>
                      <div className="native-msg-body">
                        {item.text || (item.interrupted ? '（已中断）' : '…')}
                      </div>
                    </div>
                  );
                }
                const tool = item.tool;
                return (
                  <details key={item.key} className={`native-tool${tool.isError ? ' error' : ''}`}>
                    <summary>
                      <span className="native-tool-name">{tool.name}</span>
                      <span className="native-tool-status">
                        {tool.pending ? '执行中…' : tool.isError ? '失败' : '完成'}
                      </span>
                    </summary>
                    <pre className="native-tool-args">{tool.arguments}</pre>
                    {tool.resultText && <pre className="native-tool-result">{tool.resultText}</pre>}
                  </details>
                );
              })}
              {draft && (
                <div className="native-msg assistant">
                  <div className="native-msg-role">青梧</div>
                  <div className="native-msg-body">{draft}</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {(approvals.length > 0 || questions.length > 0) && (
              <div className="native-interactions">
                {approvals.map((approval) => (
                  <div key={approval.approvalId} className="native-card approval">
                    <div className="native-card-title">请求授权：{approval.toolName}</div>
                    {approval.reason && <div className="native-card-text">{approval.reason}</div>}
                    <div className="native-card-actions">
                      <button
                        className="primary"
                        onClick={() => void handleApproval(approval, 'allowed-once')}
                      >
                        允许一次
                      </button>
                      <button onClick={() => void handleApproval(approval, 'rejected')}>拒绝</button>
                    </div>
                  </div>
                ))}
                {questions.map((question) =>
                  question.questions.map((q) => (
                    <div key={`${question.rpcId}-${q.id}`} className="native-card question">
                      <div className="native-card-title">{q.question}</div>
                      {q.detail && <div className="native-card-text">{q.detail}</div>}
                      <div className="native-card-actions">
                        {(q.options ?? []).map((option) => (
                          <button
                            key={option.label}
                            onClick={() => void handleQuestion(question, q.id, option.label)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="native-composer">
              <textarea
                value={input}
                placeholder={currentId ? '输入消息，Enter 发送，Shift+Enter 换行' : ''}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              {running ? (
                <button className="native-send stop" onClick={() => void handleStop()}>
                  停止
                </button>
              ) : (
                <button
                  className="native-send"
                  disabled={!input.trim()}
                  onClick={() => void handleSend()}
                >
                  发送
                </button>
              )}
            </div>
          </>
        )}
        {error && (
          <div className="native-error" onClick={() => setError(null)}>
            {error}（点击关闭）
          </div>
        )}
      </main>
    </div>
  );
}
