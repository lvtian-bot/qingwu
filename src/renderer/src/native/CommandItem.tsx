/**
 * 宿主斜杠指令与上下文压缩的对话流呈现（对齐 dsh 官方聊天界面）。
 *
 * 官方把 `command/run` → `command/done` 折成一行指令卡：执行中显示
 * 「执行中…」，结束后在行内给出结果，失败就地标红。这里复刻同一套语义，
 * 并用同一行的样式承载 `/compact`——它的结果比普通指令更具体
 * （压缩了多少条历史、多少 token，摘要还能展开看）。
 *
 * 之所以要这张卡：指令执行原本对界面完全不可见，用户点完「压缩」看不到
 * 任何变化，只能误以为没有反应。
 */
import { useState } from "react";
import { useT } from "../i18n";
import type { Translate } from "../i18n/core";
import type { ChatItem } from "./events";
import { ChevronDownIcon } from "./native-icons";

/** tok 数值紧凑格式：980 → 「980」，12300 → 「12.3k」。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toPrecision(3))}M`;
  }
  if (value >= 1000) {
    return `${Number((value / 1000).toPrecision(3))}k`;
  }
  return String(value);
}

/** 指令卡左侧图标：指令用终端提示符，压缩用上下文折叠符号。 */
function CommandIcon({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 3.5l4 3.5 4-3.5M4 12.5l4-3.5 4 3.5" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5.5l3 2.5-3 2.5" />
      <path d="M8.5 11h4.5" />
    </svg>
  );
}

/**
 * 压缩完成后的摘要行。
 *
 * 有精确统计时优先说「已压缩 N 条历史记录（约 N tokens）」；统计缺失时退回
 * 摘要正文概要，两者都没有时说明摘要不可用——不能让卡片停在空状态。
 */
function compactionSummary(
  outcome: Extract<ChatItem, { kind: "compaction" }>["outcome"],
  t: Translate,
): string {
  if (!outcome) return t("chat.compaction.running");
  if (outcome.kind === "error") {
    return outcome.text || t("chat.compaction.failed");
  }
  if (outcome.itemCount !== undefined && outcome.tokenCount !== undefined) {
    return t("chat.compaction.completed", {
      items: outcome.itemCount,
      tokens: formatTokens(outcome.tokenCount),
    });
  }
  if (outcome.summary) return t("chat.compaction.expand");
  return t("chat.compaction.completedPlain");
}

/** 一张通用指令卡：左侧图标 + 指令名 + 结果说明，可展开查看多行输出。 */
function GenericCommandRow({
  name,
  args,
  outcome,
  time,
}: {
  name: string;
  args?: string;
  outcome: Extract<ChatItem, { kind: "command" }>["outcome"];
  time: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const text = outcome?.text;
  const running = outcome === null;
  const failed = outcome?.kind === "error";
  const summary =
    outcome === null
      ? t("chat.command.running")
      : text ?? (failed ? t("chat.command.failed") : t("chat.command.done"));
  const body = text && text.includes("\n") ? text : null;
  const open = expanded && body !== null;

  return (
    <div className="native-command" data-state={running ? "running" : failed ? "error" : "ok"}>
      <button
        type="button"
        className="native-command-head"
        disabled={body === null}
        aria-expanded={body === null ? undefined : open}
        onClick={() => {
          if (body !== null) setExpanded((value) => !value);
        }}
        title={text ?? undefined}
      >
        <span className="native-command-icon">
          <CommandIcon />
        </span>
        <span className="native-command-name">
          /{name || t("chat.command.title")}
          {args ? ` ${args}` : ""}
        </span>
        <span className="native-command-sep" aria-hidden="true" />
        <span className="native-command-summary" data-error={failed || undefined}>
          {summary}
        </span>
        {body !== null && (
          <ChevronDownIcon className={`native-command-chevron${open ? " open" : ""}`} />
        )}
      </button>
      {open && <pre className="native-command-body">{body}</pre>}
      <span className="native-msg-time native-command-time">
        {formatStamp(time, t)}
      </span>
    </div>
  );
}

/** 毫秒 → 「9月20日 16:46」；跨年补年份（与轮次时间戳同一格式）。 */
function formatStamp(ms: number, t: Translate): string {
  const date = new Date(ms);
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
  const md = t("chat.turns.time.monthDay", {
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
  return date.getFullYear() === new Date().getFullYear()
    ? `${md} ${hhmm}`
    : t("chat.turns.time.withYear", { year: date.getFullYear(), monthDay: md });
}

/** `/compact` 专用行：与指令卡同构，摘要可展开查看。 */
function CompactionRow({
  outcome,
  time,
}: {
  outcome: Extract<ChatItem, { kind: "compaction" }>["outcome"];
  time: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const running = outcome === null;
  const failed = outcome?.kind === "error";
  const summaryText = compactionSummary(outcome, t);
  const body = outcome?.summary ?? null;
  const open = expanded && body !== null;

  return (
    <div className="native-command" data-state={running ? "running" : failed ? "error" : "ok"}>
      <button
        type="button"
        className="native-command-head"
        disabled={body === null}
        aria-expanded={body === null ? undefined : open}
        onClick={() => {
          if (body !== null) setExpanded((value) => !value);
        }}
      >
        <span className="native-command-icon">
          <CommandIcon compact />
        </span>
        <span className="native-command-name">{t("chat.compaction.title")}</span>
        <span className="native-command-sep" aria-hidden="true" />
        <span className="native-command-summary" data-error={failed || undefined}>
          {summaryText}
        </span>
        {body !== null && (
          <ChevronDownIcon className={`native-command-chevron${open ? " open" : ""}`} />
        )}
      </button>
      {open && <pre className="native-command-body">{body}</pre>}
      <span className="native-msg-time native-command-time">
        {formatStamp(time, t)}
      </span>
    </div>
  );
}

/** 指令条目分发：压缩走专用行，其余指令走通用指令卡。 */
export function CommandItem({
  item,
}: {
  item: Extract<ChatItem, { kind: "command" | "compaction" }>;
}) {
  if (item.kind === "compaction") {
    return <CompactionRow outcome={item.outcome} time={item.time} />;
  }
  return (
    <GenericCommandRow
      name={item.name}
      args={item.args}
      outcome={item.outcome}
      time={item.time}
    />
  );
}
