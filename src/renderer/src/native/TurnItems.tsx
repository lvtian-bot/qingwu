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
}: {
  item: Extract<ChatItem, { kind: "assistant" }>;
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
  onPreviewImage,
}: {
  view: TurnView;
  cwd?: string;
  sessionId?: string | null;
  onPreviewImage?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const renderItem = (item: MarkedChatItem, showReasoning = true) => {
    if (item.kind === "tool") {
      return <ToolCard key={item.key} tool={item.tool} cwd={cwd} />;
    }
    if (item.kind === "assistant") {
      // 思考行的显示由调用方决定：过程折叠行收起时，思考已经由那一行代表，
      // 答复里再挂一条「思考」就是同一段推理重复两遍（对齐官方：过程行接管）。
      if (
        !item.text &&
        !(showReasoning && item.reasoning) &&
        !item.interrupted
      ) {
        return null;
      }
      return (
        <div key={item.key} className="native-msg assistant">
          {showReasoning && item.reasoning && (
            <ReasoningRow text={item.reasoning} />
          )}
          <AssistantBody item={item} />
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

  // 没收束完整一轮（运行中、或整轮没有答复）时照旧逐条显示，不折叠
  if (!view.foldable || !view.answer) {
    return <>{view.items.map((item) => renderItem(item))}</>;
  }
  return (
    <>
      <TurnProcessRow
        toolCount={view.toolCount}
        messageCount={view.messageCount}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="native-turn-process-items">
          {view.context.map((item) => renderItem(item))}
        </div>
      )}
      {/* 折叠行收起时思考由它代表，展开后答复里的思考行照常显示 */}
      {renderItem(view.answer, open)}
    </>
  );
}
