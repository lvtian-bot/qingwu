import { useState } from "react";
import type { ChatItem, MarkedChatItem, TurnView } from "./events";
import { MessageImageView } from "./images";
import { Markdown } from "./markdown";
import { ChevronDownIcon } from "./native-icons";
import { ReasoningRow } from "./ReasoningRow";
import { ToolCard } from "./ToolCard";

/** 毫秒 → 「3m 55s」/「42s」。 */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** 助手消息复制按钮：点击后 1.5s 内显示「已复制」。 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="native-msg-action"
      title="复制回复"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied && <span>已复制</span>}
    </button>
  );
}

/** 助手答复分叉按钮：从这一轮答复切分出新会话继续对话，原会话保持不动。 */
function ForkButton({ onFork }: { onFork: () => void }) {
  return (
    <button className="native-msg-action" title="从这条回复分出新会话" onClick={onFork}>
      <svg
        viewBox="0 0 24 24"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    </button>
  );
}

/**
 * 整轮过程折叠行（对齐官方「已思考 · N 次工具调用」）：
 * 一轮收束后，把答复之前的思考与执行收进这一行，点开才铺开。
 */
function TurnProcessRow({
  toolCount,
  messageCount,
  open,
  onToggle,
}: {
  toolCount: number;
  messageCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  const labels: string[] = [];
  if (toolCount > 0) labels.push(`${toolCount} 次工具调用`);
  if (messageCount > 0) labels.push(`${messageCount} 条消息`);
  return (
    <button
      type="button"
      className="native-turn-process"
      data-open={open || undefined}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="native-turn-process-label">
        {labels.length === 0 ? "已思考" : labels.join(" · ")}
      </span>
      <ChevronDownIcon className="native-turn-process-chevron" />
    </button>
  );
}

/** 一条助手消息的正文与元信息行。 */
function AssistantBody({
  item,
  forkable,
  onFork,
}: {
  item: Extract<ChatItem, { kind: "assistant" }>;
  forkable?: boolean;
  onFork?: () => void;
}) {
  return (
    <>
      {(item.text || item.interrupted) && (
        <div className="native-msg-body">
          <Markdown text={item.text} />
          {item.interrupted && !item.text && (
            <span className="native-muted">（已中断）</span>
          )}
        </div>
      )}
      {item.text && (
        <div className="native-msg-meta">
          {item.startTime != null && (
            <span>用时 {formatDuration(item.time - item.startTime)}</span>
          )}
          <span style={{ flex: 1 }} />
          {forkable && onFork && <ForkButton onFork={onFork} />}
          <CopyButton text={item.text} />
        </div>
      )}
    </>
  );
}

/**
 * 一轮会话的渲染：按轮次把过程与答复分开——过程（思考、工具调用、中间消息）
 * 在轮次收束后收进折叠行，答复永远直接显示。
 */
export function TurnItems({
  view,
  cwd,
  sessionId,
  collapseProcess = false,
  onPreviewImage,
  onFork,
}: {
  view: TurnView;
  cwd?: string;
  sessionId?: string | null;
  collapseProcess?: boolean;
  onPreviewImage?: (url: string) => void;
  /** 从这一轮答复分叉（session/fork）。缺省或会话运行中不提供分叉按钮。 */
  onFork?: (atSeq: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const renderItem = (item: MarkedChatItem, showReasoning = true) => {
    if (item.kind === "tool") {
      return <ToolCard key={item.key} tool={item.tool} cwd={cwd} />;
    }
    if (item.kind === "assistant") {
      // 分叉按钮只挂在这一轮的正式答复上（answer 仅在轮次收束后有值，
      // 运行中的轮次天然不出现）；思考行、过程消息一律不挂。
      const isAnswer = item.key === view.answer?.key;
      // 思考行的显示由调用方决定：过程折叠行收起时，思考已经由那一行代表，
      // 答复里再挂一条「思考」就是同一段推理重复两遍（对齐官方：过程行接管）。
      if (
        !item.text &&
        !(showReasoning && item.reasoning) &&
        !item.interrupted
      ) {
        return null;
      }
      // 没有正文回复且未中断的独立思考步骤：直接作为过程折叠行渲染，
      // 不包裹助手答复气泡外壳（.native-msg.assistant），与工具卡片保持统一行距与行高
      if (!item.text && !item.interrupted) {
        return showReasoning && item.reasoning ? (
          <ReasoningRow key={item.key} text={item.reasoning} />
        ) : null;
      }
      return (
        <div key={item.key} className="native-msg assistant">
          {showReasoning && item.reasoning && (
            <ReasoningRow text={item.reasoning} />
          )}
          <AssistantBody
            item={item}
            forkable={isAnswer}
            onFork={isAnswer && onFork ? () => onFork(item.seq) : undefined}
          />
        </div>
      );
    }
    return (
      <div key={item.key} className="native-msg user">
        <div className="native-msg-user-wrap">
          {item.images && item.images.length > 0 && (
            <div className="native-msg-images">
              {item.images.map((img, idx) => (
                <MessageImageView
                  key={img.id || img.attachmentId || idx}
                  image={img}
                  sessionId={sessionId}
                  onPreview={onPreviewImage}
                />
              ))}
            </div>
          )}
          {item.text && <div className="native-msg-body">{item.text}</div>}
        </div>
      </div>
    );
  };

  // 未开启折叠设置、或没收束完整一轮（运行中、或整轮没有答复）时照旧逐条显示，不折叠
  if (!collapseProcess || !view.foldable || !view.answer) {
    return <>{view.items.map((item) => renderItem(item))}</>;
  }

  const answerIndex = view.items.findIndex(
    (item) => item.key === view.answer?.key,
  );
  const leadingUserItems =
    answerIndex >= 0
      ? view.items.slice(0, answerIndex).filter((item) => item.kind === "user")
      : [];
  const trailingItems =
    answerIndex >= 0 ? view.items.slice(answerIndex + 1) : [];

  return (
    <>
      {leadingUserItems.map((item) => renderItem(item))}
      <TurnProcessRow
        toolCount={view.toolCount}
        messageCount={view.messageCount}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open && view.context.length > 0 && (
        <div className="native-turn-process-items">
          {view.context.map((item) => renderItem(item))}
        </div>
      )}
      {/* 折叠行收起时思考由它代表，展开后答复里的思考行照常显示 */}
      {renderItem(view.answer, open)}
      {trailingItems.map((item) => renderItem(item))}
    </>
  );
}
