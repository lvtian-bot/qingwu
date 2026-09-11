/**
 * 思考过程折叠行：默认只占一行，右侧用灰色小字带出思考内容的一行摘要，
 * 点这一行才展开完整思考（对齐官方 ReasoningRow 的信息密度）。
 *
 * 摘要取哪一行按状态区分：正在思考时取最新一行并右对齐、超出左侧裁掉，
 * 让文字贴着「刚想到哪」；思考结束后取第一行、超出右侧省略号，让整轮
 * 思考收成一句稳定的话。两处都会先去 ** 标记，避免折行行首出现裸星号。
 */
import { useState } from "react";
import { ChevronDownIcon, ThinkIcon } from "./native-icons";

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function latestLine(text: string): string {
  const visible = text.trimEnd();
  const newline = visible.lastIndexOf("\n");
  return newline === -1 ? visible : visible.slice(newline + 1);
}

interface ReasoningRowProps {
  /** 该思考块全文（历史消息取落库的推理，流式取累积增量）。 */
  text: string;
  /** 是否仍在思考：决定摘要取最后一行、行内扫光与摘要对齐方向。 */
  running?: boolean;
}

export function ReasoningRow({ text, running = false }: ReasoningRowProps) {
  const [open, setOpen] = useState(false);
  const summary = (running ? latestLine(text) : firstLine(text)).replaceAll(
    "**",
    "",
  );
  return (
    <div className={`native-reasoning${open ? " open" : ""}`}>
      <div
        className={`native-reasoning-row${running ? " running" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <span className="native-reasoning-leading">
          <span className="native-reasoning-icon">
            <ThinkIcon />
          </span>
          <span className="native-reasoning-chevron">
            <ChevronDownIcon />
          </span>
        </span>
        <span className="native-reasoning-title">思考</span>
        {!open && (
          <>
            <span className="native-reasoning-dot" aria-hidden="true" />
            <span
              className="native-reasoning-summary"
              data-follow-end={running || undefined}
            >
              <span className="native-reasoning-summary-text">{summary}</span>
            </span>
          </>
        )}
      </div>
      {open && <div className="native-reasoning-body">{text}</div>}
    </div>
  );
}
