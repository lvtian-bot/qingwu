import type { MessageImageItem } from "./images";
import type {
  AssistantBlockDelta,
  AssistantMessageData,
  AssistantStreamRecord,
  ImageAttachmentRef,
  InboxMessage,
  InboxSplicedEventData,
  SessionEvent,
  ToolCallEventData,
  ToolResultEventData,
} from "./protocol";
import type { ToolItem } from "./ToolCard";
import { deriveTurnTokenUsage } from "@deepseek-ai/dsh-token-meter/client";
import type { TurnTokenUsage } from "@deepseek-ai/dsh-token-meter/client";

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

/**
 * 把重连基线里的压实记录展开回逐条增量。
 * 引擎（0.1.5 起）不再把过程内增量写进日志，中途切回正在输出的会话时，
 * 「已经写了一段的文本」和「已经想了一段的推理」只能从开场基线的压实记录还原。
 */
export function expandStreamRecords(
  records: AssistantStreamRecord[],
): AssistantBlockDelta[] {
  const deltas: AssistantBlockDelta[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (record.type === "chunk") {
      if (record.chunk) deltas.push(record.chunk);
      continue;
    }
    const members =
      record.type === "tool-call-chunks" ? record.args : record.texts;
    if (!Array.isArray(members)) continue;
    members.forEach((member) => {
      if (typeof member !== "string") return;
      if (record.type === "text-chunks") {
        deltas.push({ type: "text-delta", index: record.index, text: member });
      } else if (record.type === "reasoning-chunks") {
        deltas.push({
          type: "reasoning-delta",
          index: record.index,
          text: member,
        });
      } else {
        deltas.push({
          type: "tool-call-delta",
          index: record.index,
          id: record.id,
          ...(record.name ? { name: record.name } : {}),
          argumentsDelta: member,
        });
      }
    });
  }
  return deltas;
}

/** 从 tool/result 事件中提取调用标识、结果文本与失败标记（对齐 DSH 标准结构并兼容旧格式）。 */
export function extractToolResult(data: ToolResultEventData | null | undefined): {
  callId: string | null;
  resultText: string;
  isError: boolean;
} {
  if (!data) return { callId: null, resultText: "", isError: false };

  const message = data.message;
  const legacyBlock = Array.isArray(message?.content)
    ? (message.content[0] as Record<string, unknown> | undefined)
    : undefined;

  // 1. callId：优先底层 DSH 标准字段 toolCallId，其次 source.callId / subCallId，兼容旧 mock 的 content[0].toolCallId
  const callId =
    (typeof message?.toolCallId === "string" && message.toolCallId) ||
    (typeof message?.source?.callId === "string" && message.source.callId) ||
    (typeof (data as Record<string, unknown>).subCallId === "string" &&
      ((data as Record<string, unknown>).subCallId as string)) ||
    (typeof legacyBlock?.toolCallId === "string" && legacyBlock.toolCallId) ||
    null;

  // 2. resultText：底层 DSH 标准结构中 message.content 即为 ContentBlock[]，旧结构则在 legacyBlock.content
  let resultText = "";
  if (Array.isArray(message?.content)) {
    resultText = textOf(message.content, "text");
    if (!resultText && legacyBlock && Array.isArray(legacyBlock.content)) {
      resultText = textOf(legacyBlock.content, "text");
    }
  }

  const err = data.error;
  if (!resultText && err) {
    resultText = `${err.name || "Error"}: ${err.code || "UNKNOWN"}`;
  }

  // 3. isError
  const isError =
    Boolean(data.error) ||
    Boolean(message?.isError) ||
    Boolean(legacyBlock?.isError);

  return { callId, resultText, isError };
}

/** 会话内渲染条目。 */
export type ChatItem =
  | {
      kind: "user";
      key: string;
      text: string;
      images?: MessageImageItem[];
      time: number;
    }
  | {
      kind: "assistant";
      key: string;
      /** 会话日志事件 seq（key 同源），答复分叉（session/fork atSeq）用它定位切点。 */
      seq: number;
      text: string;
      reasoning: string;
      interrupted?: boolean;
      /** 该 assistant/message 事件时间。 */
      time: number;
      /** 最近一条 user 消息时间（无则 null），用于计算用时。 */
      startTime: number | null;
    }
  | { kind: "tool"; key: string; tool: ToolItem };

/**
 * 带轮次归属的渲染条目。
 *
 * turn 是该条目的引擎轮次（日志里 turn/start、assistant/message、tool/call 都带），
 * tier 标出它在一轮里的位置：
 * - answer：这一轮的正式回答，永远直接显示；
 * - context：回答之前的思考与执行过程（思考块、工具卡片、中间消息），
 *   轮次结束后收进「已思考 · N 次工具调用」折叠行；
 * - 未标记：正在跑的轮次里的条目，一律直接显示，不做折叠。
 */
export type MarkedChatItem = ChatItem & {
  turn: number;
  tier?: "answer" | "context";
};

/** 一轮收束后的用量与耗时指标；证据不足的项缺省，整体无证据时为 undefined。 */
export interface TurnMetrics {
  /** 提供方报告的整轮精确用量（生命周期证据不全时缺省）。 */
  usage?: TurnTokenUsage;
  /** 整轮耗时：turn/start → turn/end 的墙钟时长。 */
  durationMs?: number;
  /** 答复首字延迟：首个可见输出块减紧邻上一事件时间（含请求构建与上传）。 */
  ttftMs?: number;
  /** 聚合吐字速率（tok/s）：有计时尝试的输出合计 ÷ 生成时长合计。 */
  tokPerS?: number;
  /** 答复路由（usage.routes 缺省时由答复消息 source 回退）。 */
  answerRoute?: { provider: string; model: string };
}

/** 一轮的聚合视图：轮内条目 + 该轮是否收束 + 折叠行计数。 */
export interface TurnView {
  turn: number;
  items: MarkedChatItem[];
  /** 这一轮的正式回答（无则 null：运行中的轮次、或整轮只有过程没有答复）。 */
  answer: MarkedChatItem | null;
  /** 回答之前的过程条目。 */
  context: MarkedChatItem[];
  toolCount: number;
  messageCount: number;
  /** 轮次已收束、有答复、且过程里有内容：这一轮以过程折叠行呈现。 */
  foldable: boolean;
  /** 回答条目的 key（据它把 answer 从 items 里取出来）。 */
  answerKey: string | null;
  /** 收束轮次的用量与耗时指标（未收束或证据不足时缺省）。 */
  metrics?: TurnMetrics;
}

/**
 * 把条目按轮次聚合，并算出每轮的过程折叠视图。
 *
 * 折叠只在轮次收束（收到 turn/end）后启用：尚未收束的轮次照旧逐条显示，
 * 过程条目在「回答之前」才是过程，回答之后的条目（异常收尾的补充消息）
 * 照旧直接显示，不会被吞掉。
 */
function groupTurns(
  items: MarkedChatItem[],
  endedTurns: Set<number>,
): TurnView[] {
  const turns: TurnView[] = [];
  const indexByTurn = new Map<number, number>();
  for (const item of items) {
    let index = indexByTurn.get(item.turn);
    if (index === undefined) {
      index = turns.length;
      indexByTurn.set(item.turn, index);
      turns.push({
        turn: item.turn,
        items: [],
        answer: null,
        context: [],
        toolCount: 0,
        messageCount: 0,
        foldable: false,
        answerKey: null,
      });
    }
    turns[index].items.push(item);
  }

  for (const view of turns) {
    // 尚未收到 turn/end 的轮次仍在进行中：照旧逐条显示，不折叠
    if (!endedTurns.has(view.turn)) continue;

    // 一轮里最后一条有正文的助手消息就是这一轮的正式答复
    let answerIndex = -1;
    for (let index = view.items.length - 1; index >= 0; index -= 1) {
      const item = view.items[index];
      if (item.kind === "assistant" && item.text.trim() !== "") {
        answerIndex = index;
        break;
      }
    }
    if (answerIndex < 0) continue;

    const answerItem = view.items[answerIndex];
    answerItem.tier = "answer";
    view.answer = answerItem;
    view.answerKey = answerItem.key;

    for (let index = 0; index < answerIndex; index += 1) {
      const item = view.items[index];
      // 用户消息属于输入提示，不作为内部执行过程收进折叠
      if (item.kind !== "user") {
        item.tier = "context";
        view.context.push(item);
        if (item.kind === "tool") view.toolCount += 1;
        else if (item.kind === "assistant") view.messageCount += 1;
      }
    }

    // 过程里有内容（工具或中间消息），或答复自身带有思考过程：收起为过程折叠行
    view.foldable =
      view.context.length > 0 ||
      Boolean(
        view.answer &&
          view.answer.kind === "assistant" &&
          view.answer.reasoning,
      );
  }

  return turns;
}

/** 流记录里首个可见输出块（text / reasoning）的引擎时间戳。 */
function firstVisibleChunkTime(
  stream: AssistantStreamRecord[] | undefined,
): number | undefined {
  if (!Array.isArray(stream)) return undefined;
  let first: number | undefined;
  for (const record of stream) {
    let time: number | undefined;
    if (record.type === "text-chunks" || record.type === "reasoning-chunks") {
      time = record.time0;
    } else if (
      record.type === "chunk" &&
      (record.chunk?.type === "text-delta" ||
        record.chunk?.type === "reasoning-delta")
    ) {
      time = record.time;
    }
    if (typeof time === "number" && (first === undefined || time < first)) {
      first = time;
    }
  }
  return first;
}

/** 答复消息事件里的 provider/model 路由（缺源头或空串时不返回）。 */
function messageRoute(data: AssistantMessageData | null | undefined) {
  const message = data?.message as
    | { source?: { provider?: unknown; model?: unknown } }
    | undefined;
  const source = message?.source;
  const provider = typeof source?.provider === "string" ? source.provider : "";
  const model = typeof source?.model === "string" ? source.model : "";
  return provider && model ? { provider, model } : undefined;
}

/**
 * 折叠一轮收束事件的用量与耗时指标。
 *
 * 用量交给上游 token-meter 的精确 fold（任何生命周期证据缺失即不出数）；
 * 耗时与速率用事件及流记录自带的时间戳近似：请求起点取紧邻上一事件，
 * 生成时长取答复事件时间减首个可见输出块时间。
 */
function deriveTurnMetrics(
  events: SessionEvent[],
  answerKey: string | null,
): TurnMetrics | undefined {
  // 上游 fold 对个别缺字段事件（如无 source 的答复消息）会抛错而非返回
  // undefined；边界处兜底让用量缺省、计时指标照常。
  let usage: TurnTokenUsage | undefined;
  try {
    usage = deriveTurnTokenUsage(
      events as unknown as Parameters<typeof deriveTurnTokenUsage>[0],
    );
  } catch {
    usage = undefined;
  }

  const startEvent = events[0];
  const endEvent = events[events.length - 1];
  const durationMs =
    startEvent.type === "turn/start" && endEvent.type === "turn/end"
      ? Math.max(0, endEvent.time - startEvent.time)
      : undefined;

  const answerSeq = answerKey ? Number(answerKey.slice(2)) : NaN;
  let ttftMs: number | undefined;
  let outputSum = 0;
  let spanSum = 0;
  let answerRoute: { provider: string; model: string } | undefined;
  let prevTime: number | null = null;
  for (const event of events) {
    if (event.type === "assistant/message") {
      const data = event.data as (AssistantMessageData & {
        usage?: { outputTokens?: unknown };
        stream?: AssistantStreamRecord[];
      }) | null;
      const firstChunk = firstVisibleChunkTime(data?.stream);
      if (firstChunk !== undefined) {
        if (prevTime !== null && event.seq === answerSeq) {
          ttftMs = Math.max(0, firstChunk - prevTime);
        }
        if (event.time > firstChunk) spanSum += event.time - firstChunk;
      }
      const output = data?.usage?.outputTokens;
      if (typeof output === "number" && Number.isSafeInteger(output)) {
        outputSum += output;
      }
      if (event.seq === answerSeq) answerRoute = messageRoute(data);
    }
    prevTime = event.time;
  }
  const tokPerS =
    spanSum > 0 && outputSum > 0
      ? outputSum / (spanSum / 1000)
      : undefined;

  if (
    usage === undefined &&
    durationMs === undefined &&
    ttftMs === undefined &&
    tokPerS === undefined &&
    answerRoute === undefined
  ) {
    return undefined;
  }
  return {
    ...(usage === undefined ? {} : { usage }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(ttftMs === undefined ? {} : { ttftMs }),
    ...(tokPerS === undefined ? {} : { tokPerS }),
    ...(answerRoute === undefined ? {} : { answerRoute }),
  };
}

export function foldChatItems(events: SessionEvent[]): TurnView[] {
  const tools = new Map<string, ToolItem>();
  const items: MarkedChatItem[] = [];
  /** 已经收到 turn/end 的轮次：只有这些轮次收进折叠行。 */
  const endedTurns = new Set<number>();
  /** 已收束轮次的本地事件切片（turn/start → turn/end），供指标折叠。 */
  const turnSlices = new Map<number, SessionEvent[]>();
  let slice: SessionEvent[] | null = null;
  let lastUserTime: number | null = null;
  /** 当前事件所属轮次：优先 turn/start 声明，其次沿用上一条已知轮次。 */
  let turn = 0;

  for (const event of events) {
    if (event.type === "turn/start") {
      const data = event.data as { turn?: number } | null;
      if (typeof data?.turn === "number") {
        turn = data.turn;
        slice = [event];
      }
      continue;
    }
    if (event.type === "turn/end") {
      const data = event.data as { turn?: number } | null;
      if (typeof data?.turn === "number") {
        endedTurns.add(data.turn);
        if (slice !== null) {
          slice.push(event);
          turnSlices.set(data.turn, slice);
          slice = null;
        }
      }
      continue;
    }
    if (slice !== null) slice.push(event);
    if (event.type === "user/message") {
      const data = event.data as {
        source?: { kind: string };
        content?: unknown[];
      } | null;
      if (data?.source?.kind === "user" && Array.isArray(data.content)) {
        const eventTurn = (event.data as { turn?: number } | null)?.turn;
        if (typeof eventTurn === "number") turn = eventTurn;
        lastUserTime = event.time;
        const images: MessageImageItem[] = [];
        for (const block of data.content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as { type: unknown }).type === "image"
          ) {
            const att = (block as { attachment?: ImageAttachmentRef })
              .attachment;
            if (att && typeof att.attachmentId === "string") {
              images.push({
                attachmentId: att.attachmentId,
                mediaType: att.mediaType,
                name: att.name,
                width: att.width,
                height: att.height,
              });
            }
          }
        }
        items.push({
          kind: "user",
          key: `u-${event.seq}`,
          text: textOf(data.content, "text"),
          images: images.length > 0 ? images : undefined,
          time: event.time,
          turn,
        });
      }
    } else if (event.type === "assistant/message") {
      const data = event.data as AssistantMessageData | null;
      if (typeof data?.turn === "number") turn = data.turn;
      const content = data?.message?.content;
      items.push({
        kind: "assistant",
        key: `a-${event.seq}`,
        seq: event.seq,
        text: content ? textOf(content, "text") : "",
        reasoning: content ? textOf(content, "reasoning") : "",
        interrupted: data?.interrupted,
        time: event.time,
        startTime: lastUserTime,
        turn,
      });
    } else if (event.type === "tool/call") {
      const data = event.data as ToolCallEventData;
      if (typeof data.turn === "number") turn = data.turn;
      const item: ToolItem = {
        callId: data.callId,
        name: data.name,
        arguments: data.arguments,
        pending: true,
        callTime: event.time,
      };
      tools.set(data.callId, item);
      items.push({ kind: "tool", key: `t-${event.seq}`, tool: item, turn });
    } else if (event.type === "tool/result") {
      const data = event.data as ToolResultEventData;
      const { callId, resultText, isError } = extractToolResult(data);
      if (callId) {
        const target = tools.get(callId);
        if (target) {
          target.pending = false;
          target.resultTime = event.time;
          target.resultText = resultText;
          target.isError = isError;
        } else {
          items.push({
            kind: "tool",
            key: `t-${event.seq}`,
            tool: {
              callId,
              name: "tool",
              arguments: "",
              resultText,
              isError,
              pending: false,
              resultTime: event.time,
            },
            turn,
          });
        }
      }
    }
  }

  // 一轮里最后一条有正文的助手消息就是这一轮的答复；它之前的内部条目都是过程。
  // 只有已经收到 turn/end 的轮次才收：正在跑的轮次中途也可能已经有一条答复，
  // 那时收起来会把后面还在跑的过程挡在外面（且运行中用户正要看过程）。
  const views = groupTurns(items, endedTurns);
  for (const view of views) {
    const turnSlice = turnSlices.get(view.turn);
    if (turnSlice) view.metrics = deriveTurnMetrics(turnSlice, view.answerKey);
  }
  return views;
}

/**
 * 待发送条目：来自引擎 inbox（next-turn = 排队中，next-step = 插话中），
 * 或来自本地乐观回显（pending，尚未被宿主确认）。
 */
export interface QueuedItem {
  /** 引擎消息 id（session/updateQueue 用它寻址）；回显为本地 id。 */
  id: string;
  /** 本机提交时铸的 requestId，用于回显退休。 */
  rpcId?: string;
  placement: "next-turn" | "next-step";
  text: string;
  images?: MessageImageItem[];
  pending?: boolean;
}

/**
 * 从日志事件折出当前待发送队列。
 *
 * inbox 变更以 durable 事件 `agent/inbox/spliced` 记录（target/start/removedCount/inserted），
 * 因此无需额外订阅控制流即可在切换会话、重连后重建队列。
 * 只保留人提交的消息（source.kind === 'user'），跳过插件注入的上下文消息。
 */
export function foldQueue(events: SessionEvent[]): {
  queue: QueuedItem[];
  rpcIds: Set<string>;
} {
  const lists: Record<"next-turn" | "next-step", InboxMessage[]> = {
    "next-turn": [],
    "next-step": [],
  };
  for (const event of events) {
    if (event.type !== "agent/inbox/spliced") continue;
    const data = event.data as InboxSplicedEventData | null;
    if (!data || (data.target !== "next-turn" && data.target !== "next-step")) {
      continue;
    }
    const list = lists[data.target];
    const start = Math.min(Math.max(Number(data.start) || 0, 0), list.length);
    const removed = Math.max(Number(data.removedCount) || 0, 0);
    const inserted = Array.isArray(data.inserted) ? data.inserted : [];
    list.splice(start, Math.min(removed, list.length - start), ...inserted);
  }

  const queue: QueuedItem[] = [];
  const rpcIds = new Set<string>();
  for (const placement of ["next-turn", "next-step"] as const) {
    for (const message of lists[placement]) {
      if (message.source?.kind !== "user") continue;
      const rpcId = message.source.rpcId;
      if (typeof rpcId === "string") rpcIds.add(rpcId);
      const images: MessageImageItem[] = [];
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as { type: unknown }).type === "image"
          ) {
            const att = (block as { attachment?: ImageAttachmentRef })
              .attachment;
            if (att && typeof att.attachmentId === "string") {
              images.push({
                attachmentId: att.attachmentId,
                mediaType: att.mediaType,
                name: att.name,
                width: att.width,
                height: att.height,
              });
            }
          }
        }
      }
      queue.push({
        id: message.id ?? `${placement}-${queue.length}`,
        rpcId: typeof rpcId === "string" ? rpcId : undefined,
        placement,
        text: textOf(message.content ?? [], "text"),
        images: images.length > 0 ? images : undefined,
      });
    }
  }
  return { queue, rpcIds };
}

/** 日志里已经落库的用户消息所携带的 requestId（回显退休用）。 */
export function foldUserRpcIds(events: SessionEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== "user/message") continue;
    const data = event.data as { source?: { rpcId?: string } } | null;
    const rpcId = data?.source?.rpcId;
    if (typeof rpcId === "string") ids.add(rpcId);
  }
  return ids;
}

/**
 * 当前轮的开始时间（最近一次 turn/start 的事件时间戳），驱动底部「工作中 X 秒」计时。
 * 从后往前找，多轮排队时取到的总是尚未收束的最新一轮；开场快照自带历史事件，
 * 切进已经运行中的会话也能直接还原计时起点。窗口里没有 turn/start 时返回 null。
 */
export function lastTurnStartTime(events: SessionEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "turn/start") return events[i].time;
  }
  return null;
}
