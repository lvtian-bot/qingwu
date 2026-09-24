/** 青梧界面编排：组合引擎流、草稿、滚动、模型选择与侧栏操作 hooks，负责任务发送与决策回执。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatWidth, UiMode } from "../../../shared/types";
import { Markdown } from "./markdown";
import "./native.css";
import { foldPanelData } from "./panel-data";
import {
  Endpoints,
  type CommandExecution,
  type QueueAction,
  type UserQuestionAnswer,
} from "./protocol";
import {
  BASELINE_HOST_COMMANDS,
  CLIENT_COMMANDS,
  mergeCommands,
  parseSlashLine,
} from "./slash-commands";
import { type FileReferenceCandidate } from "./file-mentions";
import { ReasoningRow } from "./ReasoningRow";
import { PanelIcon, RightPanel } from "./RightPanel";
import { ChevronDownIcon } from "./native-icons";
import { TodoPanel } from "./TodoPanel";
import { usePanelWidth } from "./usePanelWidth";
import { ChatComposer } from "./ChatComposer";
import { ConnectionBanner } from "./ConnectionBanner";
import { fileToBase64, LightboxModal } from "./images";
import {
  groupPendingEntries,
  PendingInteraction,
  type PendingApproval,
  type PendingKind,
  type PendingQuestion,
} from "./PendingInteraction";
import { QueueStrip } from "./QueueStrip";
import { rpc, toErrMsg } from "./rpc";
import { RunningStrip } from "./RunningStrip";
import { SessionSidebar, useSessionSidebar } from "./SessionSidebar";
import { sessionTitle } from "./sidebar-data";
import { TurnItems } from "./TurnItems";
import { WorkspaceChip } from "./WorkspaceChip";
import { SettingsPage } from "./SettingsPage";
import type { QueuedItem } from "./events";
import { useChatScroll, useChatScrollFollow } from "./useChatScroll";
import { useComposerDrafts } from "./useComposerDrafts";
import { useEngineConnection } from "./useEngineConnection";
import { useEngineStreams } from "./useEngineStreams";
import { useModelSelection } from "./useModelSelection";
import { useSessionActions } from "./useSessionActions";

const qingwu = window.qingwu;

/** 聊天区宽度档位 → 聊天主列上的 CSS 类（紧凑档即默认令牌，无类）。 */
function chatWidthClass(width: ChatWidth | undefined): string {
  if (width === "medium") return " chat-w-medium";
  if (width === "wide") return " chat-w-wide";
  return "";
}

export function NativeApp({
  sidebarCollapsed,
}: {
  /** 侧栏折叠态（开关在标题栏菜单栏，状态由入口层持有，与 TitleBar 共用）。 */
  sidebarCollapsed: boolean;
}) {
  const [visible, setVisible] = useState(false);
  /** 设置面板显隐状态 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 是否折叠回合执行过程与工具调用（应用设置项，默认 false 与 DSH 平铺一致） */
  const [collapseProcess, setCollapseProcess] = useState(false);
  /** 聊天区内容列宽档位（应用设置项，默认紧凑与 DSH 一致） */
  const [chatWidth, setChatWidth] = useState<ChatWidth>("narrow");
  /** 最近活跃工作区（对齐官方 New Session 语义：新会话落在这里）。 */
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** 当前会话 id 的最新值（异步回调与列表对账用）。 */
  const currentIdRef = useRef<string | null>(currentId);
  currentIdRef.current = currentId;
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  /** 右侧面板折叠态（默认收起，需要时再展开）。 */
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 正在处理的队列操作条目 id（按钮禁用态）。 */
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (window.qingwu?.getAppSettings) {
      window.qingwu
        .getAppSettings()
        .then((s) => {
          if (s) {
            setCollapseProcess(Boolean(s.collapseProcess));
            setChatWidth(s.chatWidth ?? "narrow");
          }
        })
        .catch(() => {});
    }
    if (window.qingwu?.onAppSettingsChanged) {
      return window.qingwu.onAppSettingsChanged((s) => {
        setCollapseProcess(Boolean(s.collapseProcess));
        setChatWidth(s.chatWidth ?? "narrow");
      });
    }
    return undefined;
  }, []);

  /** 侧栏宽度控制器：主侧栏与设置页侧栏共用同一实例，任一边拖拽两边同步。 */
  const sidebarPanel = usePanelWidth({
    storageKey: "qingwu.native.sidebarWidth",
    defaultWidth: 232,
    min: 180,
    max: 400,
  });
  /** 右侧面板宽度（拖拽调节，localStorage 记忆，双击复位）。 */
  const rightPanel = usePanelWidth({
    storageKey: "qingwu.native.panelWidth",
    defaultWidth: 300,
    min: 220,
    max: 480,
  });

  const { dshConnected, reconnecting, handleManualReconnect } =
    useEngineConnection();

  const drafts = useComposerDrafts({ currentIdRef, setError });
  const {
    input,
    draftImages,
    textareaRef,
    handleInputChange,
    handleAddImages,
    handleRemoveDraftImage,
    handleChatDragOver,
    handleChatDrop,
    clearForSubmit,
    captureForSubmit,
    clearTextDraft,
    restoreAfterFailure,
    loadForSession,
    discardFor,
  } = drafts;

  const scroll = useChatScroll();
  const { resetForSessionSwitch, capturePrependAnchor, scrollToBottom } =
    scroll;

  /** 会话切换复位（给引擎流 hook 的稳定回调：滚动复位 + 载入该会话草稿）。 */
  const handleSessionSwitched = useCallback(
    (sessionId: string | null) => {
      resetForSessionSwitch();
      loadForSession(sessionId);
    },
    [resetForSessionSwitch, loadForSession],
  );
  /** 会话在外部被删除时的草稿清理（给引擎流 hook 的稳定回调）。 */
  const handleSessionRemoved = useCallback(
    (sessionId: string) => discardFor(sessionId),
    [discardFor],
  );

  const streams = useEngineStreams({
    currentId,
    currentIdRef,
    setCurrentId,
    setError,
    onSessionSwitched: handleSessionSwitched,
    onSessionRemoved: handleSessionRemoved,
    capturePrependAnchor,
  });
  const {
    sessions,
    setSessions,
    workspaces,
    setWorkspaces,
    archivedSessionIds,
    setArchivedSessionIds,
    unreadFinishedSessionIds,
    setUnreadFinishedSessionIds,
    refreshSessions,
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
    draft,
    liveReasoning,
    reasoningActive,
    toolCalling,
    approvals,
    setApprovals,
    questions,
    setQuestions,
    currentEventsClientId,
    hostCommands,
    skills,
    pushEcho,
    removeEchoByRpcId,
  } = streams;

  useChatScrollFollow(scroll, {
    items,
    echoes,
    queue,
    draft,
    liveReasoning,
    toolCalling,
    approvals,
    questions,
    loadingHistory,
  });

  const archivedSet = useMemo(
    () => new Set(archivedSessionIds),
    [archivedSessionIds],
  );

  /** 会话 → 所属工作区映射（点击会话时更新活跃工作区）。 */
  const workspaceOfSession = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) {
      for (const id of ws.sessionIds) map.set(id, ws.workspaceId);
    }
    return map;
  }, [workspaces]);

  const actions = useSessionActions({
    sessions,
    workspaces,
    archivedSet,
    currentId,
    activeWorkspaceId,
    workspaceOfSession,
    refreshSessions,
    setError,
    drafts,
    setSessions,
    setWorkspaces,
    setArchivedSessionIds,
    setUnreadFinishedSessionIds,
    setCurrentId,
    setActiveWorkspaceId,
    setSettingsOpen,
  });
  const {
    openSession,
    createSessionIn,
    handleNewSession,
    handleAddWorkspace,
    handleWorkspaceRename,
    handleWorkspaceDelete,
    handleWorkspaceReorder,
    handleSessionRename,
    handleSessionArchive,
    handleSessionUnarchive,
    handleRestoreAndOpenSession,
    handleWorkspaceChipPick,
  } = actions;

  const {
    modelCatalog,
    refreshModelCatalog,
    emptySelection,
    setEmptySelection,
    currentModelSelection,
    currentPermission,
    handleModelPick,
    handleEffortPick,
    handlePermissionPick,
  } = useModelSelection({ sessions, currentId, refreshSessions, setError });

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

  useEffect(() => {
    if (workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].workspaceId);
    }
  }, [workspaces, activeWorkspaceId]);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.workspaceId === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );

  useEffect(() => {
    qingwu.setActiveWorkspacePath?.(activeWorkspace?.path ?? null);
  }, [activeWorkspace, qingwu]);

  // 若当前打开的会话在外部被归档，清空选中态回退引导页
  useEffect(() => {
    if (currentId && archivedSet.has(currentId)) {
      setCurrentId(null);
    }
  }, [currentId, archivedSet, setCurrentId]);

  const sidebar = useSessionSidebar(sessions, workspaces, archivedSet);

  /** 会话 id → 摘要（待处理项归位要按 parentSessionId 找根会话）。 */
  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.sessionId, s])),
    [sessions],
  );

  /**
   * 待处理项按归属会话归拢：审批/问答只属于发起它的那个会话，
   * 无归属项兜底显示在当前会话（见 PendingInteraction.groupPendingEntries）。
   */
  const { pendingBySession, orphanPending } = useMemo(
    () => groupPendingEntries(approvals, questions, sessionById),
    [approvals, questions, sessionById],
  );

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

  const availableCommands = useMemo(() => {
    return mergeCommands(hostCommands, CLIENT_COMMANDS, skills);
  }, [hostCommands, skills]);

  const panelData = useMemo(() => foldPanelData(eventsRef.current), [items]);

  const handleExecuteCommand = async (
    line: string,
    options?: { preserveInput?: boolean },
  ) => {
    const text = line.trim();
    const parsed = parseSlashLine(text);
    if (!parsed) return;
    const submittedDraft = captureForSubmit(currentId);

    if (!dshConnected) {
      setError("与引擎连接中断，无法执行命令，请等待重连或点击重试");
      return;
    }

    if (parsed.name === "model") {
      if (!options?.preserveInput) {
        clearTextDraft(currentId);
      }
      return;
    }

    let targetSessionId = currentId;
    if (!targetSessionId) {
      let wsId = activeWorkspaceId;
      if (!wsId) {
        wsId = await handleAddWorkspace();
        if (!wsId) return;
      }
      try {
        targetSessionId = await createSessionIn(wsId);
      } catch (err) {
        setError(toErrMsg(err));
        return;
      }
    }

    const cmdDesc = hostCommands.find(
      (c) => c.name.toLowerCase() === parsed.name,
    );
    if (draftImages.length > 0 && !cmdDesc?.input?.attachments) {
      setError(`/${parsed.name} 不接受附件，请先移除附件`);
      return;
    }

    try {
      if (!options?.preserveInput) {
        clearForSubmit(currentId, submittedDraft);
      }
      scrollToBottom("auto");
      const canonicalLine = `/${parsed.name}${parsed.args ? ` ${parsed.args}` : ""}`;
      const res = await rpc<CommandExecution>(Endpoints.commandsExecute, {
        agentId: targetSessionId,
        line: canonicalLine,
        submittedAttachments: [],
      });
      if (res?.result?.kind === "error") {
        setError(res.result.text);
      }
      await refreshSessions();
    } catch (err) {
      setError(toErrMsg(err));
    }
  };

  const handleSend = async (options?: { mode?: "queue" | "steer" }) => {
    const text = input.trim();
    const images = [...draftImages];
    const submittedDraft = captureForSubmit(currentId);
    if (!text && images.length === 0) return;

    if (!dshConnected) {
      setError("与引擎连接中断，无法发送消息，请等待重连或点击重试");
      return;
    }

    // 斜杠命令拦截：仅拦截真正的宿主系统命令与客户端自处理命令，交由宿主执行，绕过模型 Prompt 循环。
    // 技能（Skill）发出的文本以 /<skill-name> 形式作为普通 prompt 提交给模型，触发底层技能调用。
    const parsedSlash = parseSlashLine(text);
    const isHostOrClientCommand =
      parsedSlash &&
      (parsedSlash.name === "model" ||
        hostCommands.some((c) => c.name.toLowerCase() === parsedSlash.name) ||
        BASELINE_HOST_COMMANDS.some(
          (c) => c.name.toLowerCase() === parsedSlash.name,
        ));

    if (isHostOrClientCommand) {
      void handleExecuteCommand(text);
      return;
    }

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
        setError(toErrMsg(err));
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
    // 发出即清空输入与该会话的草稿桶；失败时再写回（输入框高度由 Composer 按 value 重算）
    const clearedDraft = clearForSubmit(sessionId, submittedDraft);
    // 发送新提示词：强制沉底并重置贴底锁定，无论发送前是否处于历史翻看位置
    scrollToBottom("auto");
    // 乐观更新会话 updatedAt：会话立即浮顶，无需等待引擎事件轮询
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId ? { ...s, updatedAt: Date.now() } : s,
      ),
    );
    const submitMode = options?.mode ?? "queue";
    // 乐观回显：提交当帧就显示，宿主落库或入队后由事件投影退休
    const requestId = crypto.randomUUID();
    pushEcho({
      id: `echo-${requestId}`,
      rpcId: requestId,
      placement: submitMode === "steer" ? "next-step" : "next-turn",
      text,
      images: images.map((img) => ({
        id: img.id,
        url: img.previewUrl,
        name: img.name,
      })),
      pending: true,
    });
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
          mode: submitMode,
          content,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    } catch (err) {
      setError(toErrMsg(err));
      restoreAfterFailure(clearedDraft, text, images);
      removeEchoByRpcId(requestId);
    }
  };

  /** 批量插话发送全部排队消息（对齐官方 Cmd/Ctrl+Enter 在空草稿时的快捷手势）。 */
  const handleSteerQueue = async () => {
    if (!currentId || !running || queue.length === 0) return;
    scrollToBottom("auto");
    for (const item of queue) {
      if (item.pending) continue;
      try {
        await rpc(Endpoints.sessionUpdateQueue, {
          request: {
            sessionId: currentId,
            itemId: item.id,
            action: { kind: "steer" },
          },
        });
      } catch (err) {
        const msg = toErrMsg(err);
        if (
          msg.includes("steer-unavailable") ||
          msg.includes("queue-item-not-found")
        ) {
          break;
        }
        setError(msg);
        break;
      }
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
      setError(toErrMsg(err));
    } finally {
      setQueueBusyId(null);
    }
  };

  const handleApproval = async (
    approval: PendingApproval,
    outcome: "allowed-once" | "rejected",
  ) => {
    scrollToBottom("auto");
    const clientId = approval.clientId || currentEventsClientId() || "";
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
    scrollToBottom("auto");
    const clientId = question.clientId || currentEventsClientId() || "";
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
      setError(toErrMsg(err));
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
    const clientId = question.clientId || currentEventsClientId() || "";
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
      setError(toErrMsg(err));
      return false;
    }
  };

  const handleStop = async () => {
    if (!currentId) return;
    try {
      await rpc(Endpoints.sessionCancel, { request: { sessionId: currentId } });
    } catch (err) {
      setError(toErrMsg(err));
    }
  };

  /** 记录上次按下 Escape 的时间戳（连按两次 Esc 中断会话）。 */
  const lastEscTimeRef = useRef(0);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 呼出/关闭设置面板：Ctrl+, 或 Meta+,
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((prev) => !prev);
        return;
      }

      // 连按两次 Esc 中断当前会话（对齐 Codex 等工具的快捷叫停与防误触机制）
      if (e.key === "Escape") {
        // 若事件已被内层浮层或弹层消费（如 @ 补全下拉、/ 命令菜单、大图预览或设置页），重置计数并忽略
        if (e.defaultPrevented || settingsOpen || lightboxUrl) {
          lastEscTimeRef.current = 0;
          return;
        }
        // 仅在会话处于运行态时生效
        if (!running || !currentId) {
          lastEscTimeRef.current = 0;
          return;
        }
        const now = Date.now();
        if (now - lastEscTimeRef.current <= 600) {
          // 600ms 内连按第二次 Esc：立即中断会话并重置计时
          lastEscTimeRef.current = 0;
          e.preventDefault();
          void handleStop();
        } else {
          // 第一次按下 Esc：记录当前时间戳
          lastEscTimeRef.current = now;
        }
      }
    };
    // 主进程菜单动作「设置」经 IPC 通知打开设置页
    const unsubOpenSettings = window.qingwu?.onOpenSettings?.(() => {
      setSettingsOpen(true);
    });
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      unsubOpenSettings?.();
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [settingsOpen, lightboxUrl, running, currentId]);

  /** 查询当前会话或活跃工作区关联的文件/目录引用候选。 */
  const handleQueryFileReferences = useCallback(
    async (
      query: string,
      signal: AbortSignal,
    ): Promise<FileReferenceCandidate[]> => {
      let agentSessionId = currentId;
      if (!agentSessionId) {
        // 空白页：如果已有会话列表，借用一个有效会话查候选；若无会话，先建一个轻量会话
        const allSessions = sessions;
        if (allSessions.length > 0) {
          agentSessionId = allSessions[0].sessionId;
        } else {
          return [];
        }
      }

      try {
        const result = await rpc<FileReferenceCandidate[]>(
          Endpoints.fileReferencesList,
          { agentId: agentSessionId, query },
        );
        if (signal.aborted) return [];
        return Array.isArray(result) ? result : [];
      } catch (err) {
        console.warn("拉取文件引用失败:", err);
        return [];
      }
    },
    [currentId, sessions],
  );

  if (!visible) return null;

  const chipWorkspaceId = currentId
    ? (workspaceOfSession.get(currentId) ?? null)
    : activeWorkspaceId;

  // 面板展开后按钮由面板顶栏右缘接管，按钮始终贴窗口右缘
  const panelToggleButton = panelCollapsed ? (
    <button
      className="native-icon-btn"
      onClick={() => setPanelCollapsed((v) => !v)}
      title="打开面板"
      aria-label="打开面板"
    >
      <PanelIcon />
    </button>
  ) : null;

  return (
    <div className={`native-app${!sidebarCollapsed ? " has-sidebar" : ""}`}>
      <SessionSidebar
        state={sidebar}
        sidebarPanel={sidebarPanel}
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
        handleWorkspaceReorder={handleWorkspaceReorder}
        handleSessionRename={handleSessionRename}
        handleSessionArchive={handleSessionArchive}
        setError={setError}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main
        className={`native-chat${chatWidthClass(chatWidth)}`}
        onDragOver={handleChatDragOver}
        onDrop={handleChatDrop}
      >
        {!dshConnected && (
          <ConnectionBanner
            reconnecting={reconnecting}
            onReconnect={() => void handleManualReconnect()}
          />
        )}
        {showGreeting ? (
          <>
            <div className="native-chat-header">
              {/* 侧栏开关已上移标题栏菜单栏；左端留空占位，右端面板按钮才有落点 */}
              <div className="native-chat-header-left" />
              <div className="native-chat-header-right">
                {panelToggleButton}
              </div>
            </div>
            <div className="native-empty">
              <div className="native-empty-title">我们要做什么？</div>
              <div className="native-composer-stack">
                <ChatComposer
                  menuPlacement="bottom"
                  input={input}
                  onInputChange={handleInputChange}
                  onSend={(opts) => void handleSend(opts)}
                  running={false}
                  onStop={() => void handleStop()}
                  textareaRef={textareaRef}
                  draftImages={draftImages}
                  onRemoveDraftImage={handleRemoveDraftImage}
                  onAddImages={handleAddImages}
                  onPreviewImage={(url) => setLightboxUrl(url)}
                  commands={availableCommands}
                  onExecuteCommand={(line) => void handleExecuteCommand(line)}
                  onQueryFileReferences={handleQueryFileReferences}
                  contextPressure={currentProjections?.contextPressure}
                  contextBreakdown={currentProjections?.contextBreakdown}
                  catalog={modelCatalog}
                  selection={currentModelSelection}
                  permission={currentPermission}
                  permissionHint={currentId ? undefined : "新会话默认权限"}
                  onModelPick={handleModelPick}
                  onEffortPick={handleEffortPick}
                  onPermissionPick={handlePermissionPick}
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
                {panelToggleButton}
              </div>
            </div>
            <div className="native-messages-wrap">
              <div
                className="native-messages"
                ref={scroll.scrollRef}
                onScroll={scroll.handleScroll}
                onWheel={scroll.handleWheel}
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
                      collapseProcess={collapseProcess}
                      onPreviewImage={(url) => setLightboxUrl(url)}
                    />
                  ))}
                  {(liveReasoning || draft || toolCalling) && (
                    // 本轮在飞内容合成一条助手消息：思考折叠行在上、正文在下，
                    // 与回合结束后的落库布局一致，收束时不会整块跳位。
                    // 在仅有思考/工具调用提示、尚未输出正文答复时，采用紧凑过程间距。
                    <div
                      className={`native-msg assistant${!draft ? " process-only" : ""}`}
                    >
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
                  {running && (
                    // 运行状态行跟在在飞内容之后、属消息流的一部分，
                    // 随内容一起滚动（对齐官方 webui：不钉在输入框上方）
                    <RunningStrip startedAt={turnStartedAt} />
                  )}
                </div>
              </div>

              {scroll.showScrollToBottom && (
                <button
                  type="button"
                  className={`native-scroll-to-bottom${
                    running || liveReasoning || draft || toolCalling
                      ? " is-generating"
                      : ""
                  }`}
                  onClick={() => scrollToBottom("smooth")}
                  title={
                    running || liveReasoning || draft || toolCalling
                      ? "回到底部（正在生成…）"
                      : "回到底部"
                  }
                  aria-label="回到底部"
                >
                  <ChevronDownIcon />
                  {(running || liveReasoning || draft || toolCalling) && (
                    <span className="native-scroll-to-bottom-dot" />
                  )}
                </button>
              )}
            </div>

            {/* 授权/问答等待期间顶替输入框（对齐各 harness 客户端：决策弹层占输入框的槽位） */}
            <div className="native-composer">
              <div className="native-composer-stack">
                <TodoPanel todos={panelData.todos} />
                <QueueStrip
                  items={[...queue, ...echoes]}
                  running={running}
                  busyId={queueBusyId}
                  sessionId={currentId}
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
                  <ChatComposer
                    menuPlacement="top"
                    input={input}
                    onInputChange={handleInputChange}
                    onSend={(opts) => void handleSend(opts)}
                    canSteerQueue={running && queue.length > 0}
                    onSteerQueue={() => void handleSteerQueue()}
                    running={running}
                    onStop={() => void handleStop()}
                    textareaRef={textareaRef}
                    draftImages={draftImages}
                    onRemoveDraftImage={handleRemoveDraftImage}
                    onAddImages={handleAddImages}
                    onPreviewImage={(url) => setLightboxUrl(url)}
                    commands={availableCommands}
                    onExecuteCommand={(line) => void handleExecuteCommand(line)}
                    onQueryFileReferences={handleQueryFileReferences}
                    contextPressure={currentProjections?.contextPressure}
                    contextBreakdown={currentProjections?.contextBreakdown}
                    catalog={modelCatalog}
                    selection={currentModelSelection}
                    permission={currentPermission}
                    onModelPick={handleModelPick}
                    onEffortPick={handleEffortPick}
                    onPermissionPick={handlePermissionPick}
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
        deliverables={panelData.deliverables}
        workspacePath={activeWorkspace?.path}
        onToggle={() => setPanelCollapsed((v) => !v)}
      />

      {settingsOpen && (
        <SettingsPage
          onBack={() => setSettingsOpen(false)}
          sidebarPanel={sidebarPanel}
          modelCatalog={modelCatalog}
          onRefreshCatalog={() => void refreshModelCatalog()}
          dshConnected={dshConnected}
          reconnecting={reconnecting}
          onReconnect={() => void handleManualReconnect()}
          sessions={sessions}
          workspaces={workspaces}
          archivedSessionIds={archivedSessionIds}
          onUnarchiveSession={handleSessionUnarchive}
          onOpenSession={handleRestoreAndOpenSession}
        />
      )}
    </div>
  );
}
