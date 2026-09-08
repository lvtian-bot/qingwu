import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApprovalRequestPayload,
  RemoteEventFrame,
  SessionEvent,
  SessionFollowFrame,
  SessionSummary,
  ToolCallEventData,
  ToolResultEventData,
  UserQuestionsRequestPayload,
  WorkspaceFollowFrame,
  WorkspaceView,
} from './protocol';
import { Endpoints } from './protocol';
import type { DshRpcResult, DshStreamItem, UiMode } from '../../../shared/types';
import './native.css';

const qingwu = window.qingwu;

async function rpc<T>(endpoint: string, payload: unknown): Promise<T> {
  const result = (await qingwu.dshCall(endpoint, payload)) as DshRpcResult<T> | undefined;
  if (!result || typeof result.ok !== 'boolean') {
    throw new Error(`${endpoint} 返回非法结果`);
  }
  if (!result.ok) {
    throw new Error(
      `${endpoint} 失败: ${result.error?.code ?? 'unknown'} ${result.error?.message ?? ''}`
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
      const data = event.data as { source?: { kind: string }; content?: unknown[] } | null;
      if (data?.source?.kind === 'user' && Array.isArray(data.content)) {
        items.push({ kind: 'user', key: `u-${event.seq}`, text: textOf(data.content) });
      }
    } else if (event.type === 'assistant/message') {
      const data = event.data as {
        message?: { content?: unknown[] };
        interrupted?: true;
      } | null;
      items.push({
        kind: 'assistant',
        key: `a-${event.seq}`,
        text: data?.message?.content ? textOf(data.message.content) : '',
        interrupted: data?.interrupted,
      });
    } else if (event.type === 'tool/call') {
      const data = event.data as ToolCallEventData;
      const item: ToolItem = {
        callId: data.callId,
        name: data.name,
        arguments: data.arguments,
        pending: true,
      };
      tools.set(data.callId, item);
      items.push({ kind: 'tool', key: `t-${event.seq}`, tool: item });
    } else if (event.type === 'tool/result') {
      const data = event.data as ToolResultEventData;
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
  const eventsRef = useRef<SessionEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const sessionStreamRef = useRef<string | null>(null);
  const eventsClientIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | undefined>(undefined);

  const refreshSessions = useCallback(async () => {
    try {
      const listValue = await rpc<{ items: SessionSummary[] }>(Endpoints.sessionList, {
        _request: {},
      });
      setSessions(listValue.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== undefined) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => void refreshSessions(), 300);
  }, [refreshSessions]);

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

  // 全局流：$events（会话增删/状态/审批/问答）+ workspace/follow（项目注册表）
  useEffect(() => {
    const openStream = (endpoint: string, payload: unknown) => {
      void qingwu.dshStreamOpen(endpoint, payload).catch((err) => {
        setError(`打开 ${endpoint} 流失败: ${err instanceof Error ? err.message : String(err)}`);
      });
    };
    openStream('$events', {});
    openStream(Endpoints.workspaceFollow, {});

    const handleRemoteEvent = (frame: RemoteEventFrame) => {
      if (frame.type === 'ready') {
        eventsClientIdRef.current = frame.clientId;
        return;
      }
      if (frame.type === 'emit') {
        const [firstArg, secondArg] = Array.isArray(frame.args) ? frame.args : [];
        if (frame.event === 'api-session/added' && firstArg) {
          const summary = firstArg as SessionSummary;
          setSessions((prev) => {
            const rest = prev.filter((s) => s.sessionId !== summary.sessionId);
            return [summary, ...rest];
          });
        } else if (frame.event === 'api-session/removed' && typeof firstArg === 'string') {
          const removedId = firstArg;
          setSessions((prev) => prev.filter((s) => s.sessionId !== removedId));
          if (currentIdRef.current === removedId) {
            setCurrentId(null);
          }
        } else if (frame.event === 'api-session/status') {
          const sessionId = firstArg as string;
          const isRunning = Boolean(secondArg);
          if (currentIdRef.current === sessionId) setRunning(isRunning);
          setSessions((prev) =>
            prev.map((s) => (s.sessionId === sessionId ? { ...s, running: isRunning } : s))
          );
        } else if (frame.event === 'api-session/error') {
          const sessionId = firstArg as string;
          const message = secondArg as string;
          if (currentIdRef.current === sessionId) setError(message);
        } else if (frame.event === 'api-session/activity') {
          scheduleRefresh();
        }
        return;
      }
      if (frame.type === 'waterfall') {
        if (frame.event === 'approval/request') {
          const request = (frame.request ?? {}) as ApprovalRequestPayload;
          setApprovals((prev) =>
            prev.some((a) => a.eventId === frame.eventId)
              ? prev
              : [...prev, { ...request, eventId: frame.eventId, clientId: eventsClientIdRef.current ?? '' }]
          );
        } else if (frame.event === 'user-questions/request') {
          const request = (frame.request ?? {}) as UserQuestionsRequestPayload;
          setQuestions((prev) =>
            prev.some((q) => q.eventId === frame.eventId)
              ? prev
              : [...prev, { ...request, eventId: frame.eventId, clientId: eventsClientIdRef.current ?? '' }]
          );
        }
        return;
      }
      if (frame.type === 'cancel') {
        setApprovals((prev) => prev.filter((a) => a.eventId !== frame.eventId));
        setQuestions((prev) => prev.filter((q) => q.eventId !== frame.eventId));
      }
    };

    const handleWorkspaceFollow = (frame: WorkspaceFollowFrame) => {
      if (frame.type === 'baseline') {
        setWorkspaces(frame.value?.items ?? []);
        return;
      }
      if (frame.type === 'upsert' && frame.workspace) {
        setWorkspaces((prev) => {
          const rest = prev.filter((w) => w.workspaceId !== frame.workspace!.workspaceId);
          return [...rest, frame.workspace!];
        });
      } else if (frame.type === 'remove' && frame.workspaceId) {
        setWorkspaces((prev) => prev.filter((w) => w.workspaceId !== frame.workspaceId));
      } else if (frame.type === 'order' && Array.isArray(frame.workspaceIds)) {
        setWorkspaces((prev) => {
          const byId = new Map(prev.map((w) => [w.workspaceId, w]));
          return frame.workspaceIds!.map((id) => byId.get(id)).filter((w): w is WorkspaceView => Boolean(w));
        });
      }
      // archived 增量只影响归档列表，当前界面不消费
    };

    const handleStreamItem = ({ streamId: _streamId, endpoint, value }: DshStreamItem) => {
      if (!isRecord(value)) return;
      if (value.type === 'stream/error') {
        const err = value.error as { message?: string } | undefined;
        if (err?.message) setError(err.message);
        return;
      }
      if (endpoint === '$events') {
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
    setDraft('');
    setRunning(false);
    if (!currentId) return;

    setLoadingHistory(true);
    let cancelled = false;
    void qingwu.dshStreamOpen(
      Endpoints.sessionFollow,
      { request: { address: { kind: 'session', sessionId: currentId }, maxMessages: 100 } }
    ).then((streamId) => {
      if (cancelled) {
        qingwu.dshStreamCancel(streamId);
        return;
      }
      sessionStreamRef.current = streamId;
    });

    const handleFollowItem = ({ streamId, endpoint, value }: DshStreamItem) => {
      if (cancelled || endpoint !== Endpoints.sessionFollow || streamId !== sessionStreamRef.current) {
        return;
      }
      if (!isRecord(value)) return;
      if (value.type === 'stream/error' || value.type === 'stream/end') return;
      const frame = value as unknown as SessionFollowFrame;
      if (frame.type === 'snapshot') {
        const events = frame.records
          .filter((record) => record.type === 'event')
          .map((record) => record.event);
        eventsRef.current = events;
        setItems(foldChatItems(events));
        setLoadingHistory(false);
        return;
      }
      if (frame.type === 'event') {
        const event = frame.event;
        if (event.type === 'assistant/chunk') {
          const chunk = (event.data as { chunk?: { type?: string; text?: string } } | null)?.chunk;
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
            setDraft((prev) => prev + chunk.text);
          }
          return;
        }
        if (event.type === 'assistant/message') {
          setDraft('');
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
      setCurrentId(reusable.sessionId);
      return;
    }
    const value = await rpc<{ sessionId: string }>(Endpoints.sessionCreate, {
      request: { workspaceId: wsId },
    });
    await refreshSessions();
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
      const picked = await rpc<string | null>(Endpoints.directoryPickerPick, {});
      if (!picked) return;
      const created = await rpc<{ workspace: WorkspaceView }>(Endpoints.workspaceCreate, {
        request: { path: picked },
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
      await rpc(Endpoints.sessionPrompt, {
        request: {
          requestId: crypto.randomUUID(),
          sessionId: currentId,
          mode: 'queue',
          content: [{ type: 'text', text }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInput(text);
    }
  };

  const handleApproval = async (approval: PendingApproval, outcome: 'allowed-once' | 'rejected') => {
    setApprovals((prev) => prev.filter((a) => a.eventId !== approval.eventId));
    await qingwu.dshEventResult(approval.clientId, approval.eventId, {
      kind: 'result',
      value: outcome,
    });
  };

  const handleQuestion = async (question: PendingQuestion, questionId: string, label: string) => {
    await qingwu.dshEventResult(question.clientId, question.eventId, {
      kind: 'result',
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
                  <div key={approval.eventId} className="native-card approval">
                    <div className="native-card-title">请求授权：{approval.toolName ?? '工具'}</div>
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
                  (question.questions ?? []).map((q) => (
                    <div key={`${question.eventId}-${q.id}`} className="native-card question">
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
