/**
 * 引擎流订阅与会话视图状态中枢：
 * - 全局双流 `$events`（会话增删/状态/审批/问答）+ `workspace/follow`（项目注册表）；
 * - 选中会话的 `session/follow` 日志流（开场快照 + 实时增量 + revision 跳号重订阅）；
 * - 事件窗口投影成对话/队列/回显，以及会话列表刷新与「加载更早」分页。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DshStreamItem } from "../../../shared/types";
import { movesContextMeter } from "./ContextMeter";
import {
  expandStreamRecords,
  foldChatItems,
  foldQueue,
  foldUserRpcIds,
  lastTurnStartTime,
  type QueuedItem,
  type TurnView,
} from "./events";
import type {
  ApprovalRequestPayload,
  AssistantBlockDelta,
  AssistantChunkEventData,
  CommandDescriptor,
  RemoteEventFrame,
  SessionEvent,
  SessionFollowFrame,
  SessionHistoryRecord,
  SessionSummary,
  SkillDescriptor,
  SkillListResult,
  UserQuestionsRequestPayload,
  WorkspaceFollowFrame,
  WorkspaceView,
} from "./protocol";
import { Endpoints } from "./protocol";
import type { PendingApproval, PendingQuestion } from "./PendingInteraction";
import { rpc, toErrMsg } from "./rpc";
import { orderWorkspaces, sessionTitle, upsertWorkspace } from "./sidebar-data";

const qingwu = window.qingwu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface EngineStreamsOptions {
  currentId: string | null;
  /** 当前会话 id 的最新值（列表对账与事件归属判断）。 */
  currentIdRef: RefObject<string | null>;
  /** 当前会话在外部被删除时清空选中态。 */
  setCurrentId: (sessionId: string | null) => void;
  setError: (message: string | null) => void;
  /** 会话切换时的界面复位：滚动复位 + 载入该会话草稿。 */
  onSessionSwitched: (sessionId: string | null) => void;
  /** 会话在外部被删除时的草稿清理。 */
  onSessionRemoved: (sessionId: string) => void;
  /** 「加载更早」翻页前记录视口锚点（前插后按高度差复位）。 */
  capturePrependAnchor: () => void;
}

export function useEngineStreams({
  currentId,
  currentIdRef,
  setCurrentId,
  setError,
  onSessionSwitched,
  onSessionRemoved,
  capturePrependAnchor,
}: EngineStreamsOptions) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  /** 会话列表最新快照：切换会话时据它播种运行态，避免把 sessions 纳入 effect 依赖。 */
  const sessionsRef = useRef<SessionSummary[]>([]);
  sessionsRef.current = sessions;
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  /** 宿主全量已归档会话集合：列表与分组必须主动排除，解归档前不显示。 */
  const [archivedSessionIds, setArchivedSessionIds] = useState<string[]>([]);
  /** 后台执行完成但用户尚未查看的会话集合（左侧蓝点提醒）。 */
  const [unreadFinishedSessionIds, setUnreadFinishedSessionIds] = useState<
    Set<string>
  >(new Set());

  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<TurnView[]>([]);
  /** 流式正文文本（text-delta 累积，settlement 时清空转正）。 */
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
  /** 引擎 inbox 里的待发送队列（排队中／插话中），由 agent/inbox/spliced 折出。 */
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  /** 本地乐观回显：提交当帧即显示，宿主落库或入队后退休。 */
  const [echoes, setEchoes] = useState<QueuedItem[]>([]);
  /** 当前轮开始时间（最近一次 turn/start），驱动底部「工作中 X 秒」状态条。 */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /** 开场窗口之外还有更早历史（对齐官方 follow snapshot 的 hasMore）。 */
  const [historyHasMore, setHistoryHasMore] = useState(false);
  /** 「加载更早」一页在途（按钮禁用并显示加载中，对齐官方 loadingOlder）。 */
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  /** 当前会话可用的宿主斜杠命令列表。 */
  const [hostCommands, setHostCommands] = useState<CommandDescriptor[]>([]);
  /** 当前会话可用的技能列表。 */
  const [skills, setSkills] = useState<SkillDescriptor[]>([]);

  /** 当前会话事件窗口（快照 + 增量），投影数据源。 */
  const eventsRef = useRef<SessionEvent[]>([]);
  /** follow 开场帧 cursor：session/page 的 throughSeq（含）日志切点，随每代快照更新。 */
  const historyThroughSeqRef = useRef(0);
  const sessionStreamRef = useRef<string | null>(null);
  /** 快照或订阅更换即失效，不能只用会话 ID 判断旧翻页响应。 */
  const historyGenerationRef = useRef(0);
  const olderRequestRef = useRef<object | null>(null);
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
      setError(toErrMsg(err));
    }
  }, [currentIdRef, setError]);

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
    setTurnStartedAt(lastTurnStartTime(eventsRef.current));
    // 回显退休：宿主已把这条提交落成 durable user/message 或队列项
    const settled = new Set([
      ...folded.rpcIds,
      ...foldUserRpcIds(eventsRef.current),
    ]);
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

  /**
   * 「加载更早」：向 session/page 再取一页开场窗口之前的历史并前插。
   * 对齐官方 session-controller loadOlder：beforeSeq 取当前窗口最早一条的 seq
   * （host 按消息计数向前切满一页），每页 maxMessages 50；结果 records 仍是
   * seq 升序事件，直接拼进窗口重算。throughSeq 用开场帧 cursor（含）切点，
   * 越过它之前的日志不再属于本次 follow。切会话后晚到的旧结果按代际丢弃。
   */
  const loadOlderHistory = useCallback(async () => {
    const sessionId = currentIdRef.current;
    const oldest = eventsRef.current[0];
    if (!sessionId || !oldest || loadingHistory || olderRequestRef.current)
      return;
    const generation = historyGenerationRef.current;
    const request = {};
    olderRequestRef.current = request;
    const isCurrent = () =>
      currentIdRef.current === sessionId &&
      historyGenerationRef.current === generation &&
      olderRequestRef.current === request;
    setLoadingOlderHistory(true);
    try {
      const page = await rpc<{
        records: SessionHistoryRecord[];
        hasMore: boolean;
      }>(Endpoints.sessionPage, {
        request: {
          address: { kind: "session", sessionId },
          throughSeq: historyThroughSeqRef.current,
          beforeSeq: oldest.seq,
          maxMessages: 50,
        },
      });
      if (!isCurrent()) return;
      const existingSeqs = new Set(eventsRef.current.map((event) => event.seq));
      const older = page.records
        .filter((record) => record.type === "event")
        .map((record) => record.event)
        .filter(
          (event) => event.seq < oldest.seq && !existingSeqs.has(event.seq),
        );
      if (older.length > 0) {
        // 在响应被接受、即将前插时记录位置，避免在途增量提前消耗锚点。
        capturePrependAnchor();
        eventsRef.current = [...older, ...eventsRef.current];
        refreshFromEvents();
      }
      setHistoryHasMore(page.hasMore);
    } catch (err) {
      if (isCurrent()) setError(toErrMsg(err));
    } finally {
      if (isCurrent()) {
        olderRequestRef.current = null;
        setLoadingOlderHistory(false);
      }
    }
  }, [
    currentIdRef,
    loadingHistory,
    refreshFromEvents,
    setError,
    capturePrependAnchor,
  ]);

  // 全局流：$events（会话增删/状态/审批/问答）+ workspace/follow（项目注册表）
  useEffect(() => {
    const openStream = (endpoint: string, payload: unknown) => {
      void qingwu.dshStreamOpen(endpoint, payload).catch((err) => {
        setError(`打开 ${endpoint} 流失败: ${toErrMsg(err)}`);
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
          onSessionRemoved(removedId);
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
                if (s.running && !isRunning) {
                  const isAppFocused =
                    typeof document !== "undefined" && document.hasFocus();
                  if (currentIdRef.current !== sessionId) {
                    setUnreadFinishedSessionIds((u) => new Set(u).add(sessionId));
                  }
                  // 仅在应用不在前台（失焦、最小化或隐藏后台）时发送系统桌面通知；前台使用时绝不弹窗打扰
                  if (!isAppFocused) {
                    const title = sessionTitle(s);
                    void window.qingwu?.showNotification?.({
                      title: "任务执行完成",
                      body: `「${title}」任务已执行完成`,
                      sessionId,
                    });
                  }
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
      if (
        value.type === "stream/error" &&
        endpoint !== Endpoints.sessionFollow
      ) {
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
  }, [scheduleRefresh, setCurrentId, currentIdRef, onSessionRemoved, setError]);

  // 选中会话：打开 session/follow 日志流（开场快照 + 实时事件）
  useEffect(() => {
    historyGenerationRef.current++;
    olderRequestRef.current = null;
    if (sessionStreamRef.current) {
      qingwu.dshStreamCancel(sessionStreamRef.current);
      sessionStreamRef.current = null;
    }
    eventsRef.current = [];
    setItems([]);
    setHistoryHasMore(false);
    setLoadingOlderHistory(false);
    historyThroughSeqRef.current = 0;
    setDraft("");
    setLiveReasoning("");
    setReasoningActive(false);
    setToolCalling(false);
    setQueue([]);
    setEchoes([]);
    setTurnStartedAt(null);
    // 滚动复位与该会话草稿载入由界面层完成（草稿桶与滚动容器不在本 hook）
    onSessionSwitched(currentId);
    // 运行态从会话列表播种：进入一个正在跑的会话时必须立刻显示「停止」，
    // 不能等 status 事件（它只在跳变时发出，切换会话不会重放）。
    setRunning(
      sessionsRef.current.find((entry) => entry.sessionId === currentId)
        ?.running ?? false,
    );
    if (!currentId) {
      setLoadingHistory(false);
      setHostCommands([]);
      setSkills([]);
      return;
    }

    // 会话可用斜杠命令目录
    void rpc<CommandDescriptor[]>(Endpoints.commandsList, {
      agentId: currentId,
    })
      .then((cmds) => {
        if (!cancelled) setHostCommands(cmds);
      })
      .catch(() => {
        if (!cancelled) setHostCommands([]);
      });

    // 会话可用技能目录
    void rpc<SkillListResult>(Endpoints.skillsList, {
      request: { sessionId: currentId },
    })
      .then((res) => {
        if (!cancelled && res?.skills) setSkills(res.skills);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });

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

    const invalidateHistory = () => {
      historyGenerationRef.current++;
      olderRequestRef.current = null;
      setLoadingOlderHistory(false);
    };
    const failFollow = (message: string) => {
      invalidateHistory();
      setLoadingHistory(false);
      setError(message);
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
        })
        .catch((err) => {
          if (!cancelled && currentIdRef.current === currentId) {
            failFollow(`加载会话历史失败：${toErrMsg(err)}`);
          }
        });
    };

    /** revision 跳号（漏帧/重连）后本代流已不可信：重开一次，由新开场帧重建界面状态。 */
    const resyncFollow = () => {
      invalidateHistory();
      setLoadingHistory(true);
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
        currentIdRef.current !== currentId ||
        endpoint !== Endpoints.sessionFollow ||
        streamId !== sessionStreamRef.current
      ) {
        return;
      }
      if (!isRecord(value)) return;
      if (value.type === "stream/error" || value.type === "stream/end") {
        const error = value.error as { message?: string } | undefined;
        failFollow(error?.message ?? "会话数据连接已结束，请重新打开会话重试");
        return;
      }
      const frame = value as unknown as SessionFollowFrame;
      if (frame.type === "snapshot") {
        invalidateHistory();
        const events = frame.records
          .filter((record) => record.type === "event")
          .map((record) => record.event);
        eventsRef.current = events;
        historyThroughSeqRef.current = frame.cursor;
        setHistoryHasMore(frame.hasMore);
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
      historyGenerationRef.current++;
      olderRequestRef.current = null;
      unsubscribe();
      if (sessionStreamRef.current) {
        qingwu.dshStreamCancel(sessionStreamRef.current);
        sessionStreamRef.current = null;
      }
    };
  }, [
    currentId,
    currentIdRef,
    appendEvent,
    refreshFromEvents,
    onSessionSwitched,
    setError,
  ]);

  /** 发送管线用：乐观回显上屏与失败回收。 */
  const pushEcho = useCallback((echo: QueuedItem) => {
    setEchoes((prev) => [...prev, echo]);
  }, []);
  const removeEchoByRpcId = useCallback((rpcId: string) => {
    setEchoes((prev) => prev.filter((echo) => echo.rpcId !== rpcId));
  }, []);

  return {
    // 会话与工作区注册表
    sessions,
    setSessions,
    workspaces,
    setWorkspaces,
    archivedSessionIds,
    setArchivedSessionIds,
    unreadFinishedSessionIds,
    setUnreadFinishedSessionIds,
    refreshSessions,
    // 当前会话运行态与对话视图
    running,
    items,
    queue,
    echoes,
    turnStartedAt,
    eventsRef,
    loadOlderHistory,
    loadingHistory,
    historyHasMore,
    loadingOlderHistory,
    // 乐观回显（发送管线写入，事件投影退休）
    pushEcho,
    removeEchoByRpcId,
    // 流式展示态
    draft,
    liveReasoning,
    reasoningActive,
    toolCalling,
    // 待处理决策与事件流客户端
    approvals,
    setApprovals,
    questions,
    setQuestions,
    currentEventsClientId: () => eventsClientIdRef.current,
    // 会话可用命令与技能
    hostCommands,
    skills,
  };
}

/** 引擎流控制器：注册表、对话视图、待处理决策与流式展示态。 */
export type EngineStreamsApi = ReturnType<typeof useEngineStreams>;
