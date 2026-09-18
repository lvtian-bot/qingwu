/** 青梧界面编排：引擎订阅、当前会话与草稿生命周期、发送及决策回执。 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DshStreamItem, UiMode } from "../../../shared/types";
import { Markdown } from "./markdown";
import "./native.css";
import { foldPanelData } from "./panel-data";
import type {
  ApprovalRequestPayload,
  AssistantBlockDelta,
  AssistantChunkEventData,
  ModelCatalog,
  ModelSelection,
  PermissionSelect,
  QueueAction,
  RemoteEventFrame,
  SessionEvent,
  SessionFollowFrame,
  SessionHistoryRecord,
  SessionSummary,
  SettingsDescribeValue,
  UserQuestionAnswer,
  UserQuestionsRequestPayload,
  WorkspaceFollowFrame,
  WorkspaceView,
} from "./protocol";
import { Endpoints } from "./protocol";
import { ReasoningRow } from "./ReasoningRow";
import { PanelIcon, RightPanel } from "./RightPanel";
import { TodoPanel } from "./TodoPanel";
import { usePanelWidth } from "./usePanelWidth";

import { Composer } from "./Composer";
import {
  ComposerControls,
  permissionPresetsFromSchema,
} from "./ComposerControls";
import { ContextMeter, movesContextMeter } from "./ContextMeter";
import {
  expandStreamRecords,
  foldChatItems,
  foldQueue,
  foldUserRpcIds,
  type QueuedItem,
  type TurnView,
} from "./events";
import {
  fileToBase64,
  getImageMediaType,
  isSupportedImage,
  LightboxModal,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type DraftImage,
} from "./images";
import {
  ownerSessionOf,
  PENDING_PRECEDENCE,
  planReviewOf,
  PendingInteraction,
  type PendingApproval,
  type PendingEntry,
  type PendingKind,
  type PendingQuestion,
} from "./PendingInteraction";
import { QueueStrip } from "./QueueStrip";
import { rpc } from "./rpc";
import { SessionSidebar, useSessionSidebar } from "./SessionSidebar";
import { orderWorkspaces, sessionTitle, upsertWorkspace } from "./sidebar-data";
import { TurnItems } from "./TurnItems";
import { WorkspaceChip } from "./WorkspaceChip";
import { SettingsModal } from "./SettingsModal";

const qingwu = window.qingwu;

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
  /** 后台执行完成但用户尚未查看的会话集合（左侧蓝点提醒）。 */
  const [unreadFinishedSessionIds, setUnreadFinishedSessionIds] = useState<
    Set<string>
  >(new Set());

  /** 设置面板显隐状态 */
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
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
  /** 开场窗口之外还有更早历史（对齐官方 follow snapshot 的 hasMore）。 */
  const [historyHasMore, setHistoryHasMore] = useState(false);
  /** 「加载更早」一页在途（按钮禁用并显示加载中，对齐官方 loadingOlder）。 */
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  /** 右侧面板折叠态（默认收起，需要时再展开）。 */
  const [panelCollapsed, setPanelCollapsed] = useState(true);
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
  /** 右侧面板宽度（拖拽调节，localStorage 记忆，双击复位）。 */
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
  /** follow 开场帧 cursor：session/page 的 throughSeq（含）日志切点，随每代快照更新。 */
  const historyThroughSeqRef = useRef(0);
  /** 「加载更早」前插后的视口锚定：记下前插前的滚动几何，DOM 提交后按高度差复位。 */
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null);
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
    if (!sessionId || !oldest || loadingOlderHistory) return;
    const el = scrollRef.current;
    if (el) {
      restoreScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
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
      if (currentIdRef.current !== sessionId) return;
      const older = page.records
        .filter((record) => record.type === "event")
        .map((record) => record.event)
        .filter((event) => event.seq < oldest.seq);
      if (older.length > 0) {
        eventsRef.current = [...older, ...eventsRef.current];
        refreshFromEvents();
      }
      setHistoryHasMore(page.hasMore);
    } catch (err) {
      console.error("[qingwu] loadOlder failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (currentIdRef.current === sessionId) setLoadingOlderHistory(false);
    }
  }, [loadingOlderHistory, refreshFromEvents]);

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
      const value = view?.value;
      const current =
        typeof value === "object" && value !== null && "defaultPreset" in value
          ? value.defaultPreset
          : undefined;
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

  useEffect(() => {
    const activeWs = workspaces.find((w) => w.workspaceId === activeWorkspaceId);
    qingwu.setActiveWorkspacePath?.(activeWs?.path ?? null);
  }, [workspaces, activeWorkspaceId, qingwu]);

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
                if (
                  s.running &&
                  !isRunning &&
                  currentIdRef.current !== sessionId
                ) {
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
    setHistoryHasMore(false);
    setLoadingOlderHistory(false);
    historyThroughSeqRef.current = 0;
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

  // 「加载更早」前插旧内容后按高度差复位视口：用户看到的那条消息保持原地，不跳屏
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = restoreScrollRef.current;
    if (!el || !anchor) return;
    restoreScrollRef.current = null;
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
  }, [items]);

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

  const sidebar = useSessionSidebar(sessions, workspaces, archivedSet);

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
        kind: planReviewOf(question.questions ?? [])
          ? "plan-review"
          : "question",
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
          submittedAttachments: [],
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

  const panelData = useMemo(() => foldPanelData(eventsRef.current), [items]);

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
  const handleQueueAction = async (item: QueuedItem, action: QueueAction) => {
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

  const chipWorkspaceId = currentId
    ? (workspaceOfSession.get(currentId) ?? null)
    : activeWorkspaceId;

  return (
    <div className={`native-app${!sidebarCollapsed ? " has-sidebar" : ""}`}>
      <SessionSidebar
        state={sidebar}
        collapsed={sidebarCollapsed}
        currentId={currentId}
        pendingKindBySession={pendingKindBySession}
        unreadFinishedSessionIds={unreadFinishedSessionIds}
        openSession={openSession}
        createSessionIn={createSessionIn}
        handleNewSession={handleNewSession}
        handleAddWorkspace={handleAddWorkspace}
        handleWorkspaceRename={handleWorkspaceRename}
        handleWorkspaceDelete={handleWorkspaceDelete}
        handleSessionRename={handleSessionRename}
        handleSessionArchive={handleSessionArchive}
        setError={setError}
        onOpenSettings={() => setSettingsOpen(true)}
      />

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
                      permissionHint={currentId ? undefined : "新会话默认权限"}
                      onModelPick={handleModelPick}
                      onEffortPick={handleEffortPick}
                      onPermissionPick={handlePermissionPick}
                    />
                  }
                />
                <WorkspaceChip
                  workspaces={workspaces}
                  currentId={chipWorkspaceId}
                  fallbackLabel={activeWorkspaceId ? "未分组" : "选择工作区"}
                  onPick={handleWorkspaceChipPick}
                  onAdd={() => void handleAddWorkspace()}
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
                {historyHasMore && !loadingHistory && (
                  <button
                    type="button"
                    className="native-load-older"
                    disabled={loadingOlderHistory}
                    onClick={() => void loadOlderHistory()}
                  >
                    {loadingOlderHistory ? "加载中…" : "加载更早"}
                  </button>
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
                <TodoPanel todos={panelData.todos} />
                <QueueStrip
                  items={[...queue, ...echoes]}
                  running={running}
                  busyId={queueBusyId}
                  onAction={(item, action) =>
                    void handleQueueAction(item, action)
                  }
                />
                {shownPending ? (
                  <PendingInteraction
                    entry={shownPending}
                    morePending={morePending}
                    onApproval={handleApproval}
                    onQuestionAnswer={handleQuestionAnswer}
                    onQuestionDismiss={handleQuestionDismiss}
                  />
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
        <LightboxModal src={lightboxUrl} onClose={() => setLightboxUrl(null)} />
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
        fileChanges={panelData.fileChanges}
        onToggle={() => setPanelCollapsed((v) => !v)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        modelCatalog={modelCatalog}
      />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
