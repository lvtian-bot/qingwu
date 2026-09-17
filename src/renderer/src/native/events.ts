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
    const view = turns[index];
    view.items.push(item);
    if (item.tier === "answer") {
      view.answerKey = item.key;
    } else if (item.tier === "context") {
      view.context.push(item);
      if (item.kind === "tool") view.toolCount += 1;
      else if (item.kind === "assistant") view.messageCount += 1;
    }
  }
  for (const view of turns) {
    if (view.answerKey === null) continue;
    view.answer =
      view.items.find((item) => item.key === view.answerKey) ?? null;
    if (!endedTurns.has(view.turn)) continue;
    // 过程里没有可收的东西（例如整轮只有工具卡片）：不收，避免折叠行点开是空的
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

export function foldChatItems(events: SessionEvent[]): TurnView[] {
  const tools = new Map<string, ToolItem>();
  const items: MarkedChatItem[] = [];
  /** 已经收到 turn/end 的轮次：只有这些轮次收进折叠行。 */
  const endedTurns = new Set<number>();
  let lastUserTime: number | null = null;
  /** 当前事件所属轮次：优先 turn/start 声明，其次沿用上一条已知轮次。 */
  let turn = 0;

  for (const event of events) {
    if (event.type === "turn/start") {
      const data = event.data as { turn?: number } | null;
      if (typeof data?.turn === "number") turn = data.turn;
      continue;
    }
    if (event.type === "turn/end") {
      const data = event.data as { turn?: number } | null;
      if (typeof data?.turn === "number") endedTurns.add(data.turn);
      continue;
    }
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
      const block = data.message?.content?.[0];
      if (block && block.type === "tool-result") {
        const target = tools.get(block.toolCallId);
        const resultText = Array.isArray(block.content)
          ? textOf(block.content as unknown[], "text")
          : "";
        if (target) {
          target.pending = false;
          target.resultTime = event.time;
          target.resultText =
            resultText ||
            (data.error ? `${data.error.name}: ${data.error.code}` : "");
          target.isError = Boolean(data.error) || Boolean(block.isError);
        } else {
          items.push({
            kind: "tool",
            key: `t-${event.seq}`,
            tool: {
              callId: block.toolCallId,
              name: "tool",
              arguments: "",
              resultText,
              isError: Boolean(block.isError),
              pending: false,
              resultTime: event.time,
            },
            turn,
          });
        }
      }
    }
  }

  // 一轮里最后一条有正文的助手消息就是这一轮的答复；它之前的条目都是过程。
  // 只有已经收到 turn/end 的轮次才收：正在跑的轮次中途也可能已经有一条答复，
  // 那时收起来会把后面还在跑的过程挡在外面（且运行中用户正要看过程）。
  const marked = groupTurns(items, endedTurns);
  for (const view of marked) {
    if (!view.foldable) continue;
    let answerIndex = -1;
    for (let index = view.items.length - 1; index >= 0; index -= 1) {
      const item = view.items[index];
      if (item.kind === "assistant" && item.text.trim() !== "") {
        answerIndex = index;
        break;
      }
    }
    if (answerIndex < 0) continue;
    view.items.forEach((item, index) => {
      if (index === answerIndex) item.tier = "answer";
      else if (index < answerIndex) item.tier = "context";
    });
  }

  return groupTurns(items, endedTurns);
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
