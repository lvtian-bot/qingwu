import { useEffect, useRef, useState } from "react";
import type {
  ContextBreakdownProjection,
  ContextPressureProjection,
} from "./protocol";

/**
 * 上下文占用（官方 contextOccupancy 口径）：分子优先用 projectedTokens
 * （最后一次采样 + 采样后表面的启发式增减），拿不到采样或路线容量时不显示。
 */
function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): { percent: number; usedTokens: number; contextWindow: number } | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
  if (usedTokens === undefined || pressure?.contextWindow === undefined)
    return null;
  return {
    percent: Math.min(
      100,
      Math.round((usedTokens / pressure.contextWindow) * 100),
    ),
    usedTokens,
    contextWindow: pressure.contextWindow,
  };
}

/** 紧凑 token 计数（官方口径：<1e3 原样，<1e6 用 K，否则 M；≥100 取整否则一位小数）。 */
function formatTokens(value: number): string {
  const scaled = (candidate: number) =>
    candidate >= 100
      ? String(Math.round(candidate))
      : String(Math.round(candidate * 10) / 10);
  if (value < 1000) return String(value);
  if (value < 1000000) return `${scaled(value / 1000)}K`;
  return `${scaled(value / 1000000)}M`;
}

/** 构成行（顺序即进度条分段顺序，颜色与图例一致）。 */
const CONTEXT_ROWS: {
  key: keyof ContextBreakdownProjection;
  label: string;
  tint: string;
}[] = [
  { key: "systemTokens", label: "系统提示词", tint: "system" },
  { key: "toolsTokens", label: "工具定义", tint: "tools" },
  { key: "messageTokens", label: "对话消息", tint: "messages" },
];

/** 环几何：与官方一致（14px 视窗、2px 描边、半径 5.5）。 */
const METER_RADIUS = 5.5;

const METER_CIRCUMFERENCE = 2 * Math.PI * METER_RADIUS;

/**
 * 会移动上下文占用/用量投影的会话事件：request/context 带来路线容量、
 * request/header 带来工具定义价格、assistant 结算带来提供方 usage 采样，
 * 其余可见表面（消息、工具结果）改变表面 token 总量，压缩则成段替换表面。
 */
const CONTEXT_METER_EVENTS = new Set([
  "request/context",
  "request/header",
  "assistant/message",
  "assistant/attempt",
  "tool/result",
  "system/message",
]);

export function movesContextMeter(type: string): boolean {
  return CONTEXT_METER_EVENTS.has(type) || type.startsWith("compaction/");
}

/**
 * 上下文占用环 + 构成面板（对齐官方 ContextMeter）：环贴发送按钮，
 * 悬停显示百分比、点击展开系统提示词／工具定义／对话消息的构成。
 * 提供方既没报压力也没报路线容量时整块不渲染（官方同此）。
 */
export function ContextMeter({
  pressure,
  breakdown,
}: {
  pressure?: ContextPressureProjection;
  breakdown?: ContextBreakdownProjection;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const occupancy = contextOccupancy(pressure);
  const available = occupancy !== null;

  useEffect(() => {
    if (!available && open) setOpen(false);
  }, [available, open]);

  // 点击面板外或按 Esc 收起（与官方同）
  useEffect(() => {
    if (!open || !available) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target) === true
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [available, open]);

  if (occupancy === null) return null;

  const percent = occupancy.percent;
  const total = breakdown
    ? breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
    : 0;
  const segments =
    !breakdown || total === 0
      ? [{ key: "total", tint: "", width: percent }]
      : CONTEXT_ROWS.map((row) => ({
          key: row.key,
          tint: row.tint,
          width: (percent * breakdown[row.key]) / total,
        })).filter((segment) => segment.width > 0);

  return (
    <span className="native-meter" ref={rootRef}>
      <button
        type="button"
        className="native-meter-trigger"
        aria-label={`上下文已用 ${percent}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`上下文已用 ${percent}%`}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle
            className="native-meter-track"
            cx="7"
            cy="7"
            r={METER_RADIUS}
          />
          <circle
            className="native-meter-fill"
            cx="7"
            cy="7"
            r={METER_RADIUS}
            strokeDasharray={`${(METER_CIRCUMFERENCE * percent) / 100} ${METER_CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>
      {open && (
        <div
          className="native-meter-panel"
          role="dialog"
          aria-label="上下文已用"
        >
          <div className="native-meter-head">
            <span className="native-meter-headline">上下文已用</span>
            <span className="native-meter-percent">{percent}%</span>
            <span className="native-meter-figures">
              ~{formatTokens(occupancy.usedTokens)} /{" "}
              {formatTokens(occupancy.contextWindow)}
            </span>
          </div>
          <div className="native-meter-bar">
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={
                  segment.tint
                    ? `native-meter-segment ${segment.tint}`
                    : "native-meter-segment"
                }
                style={{ width: `${segment.width}%` }}
              />
            ))}
          </div>
          {breakdown && (
            <dl className="native-meter-rows">
              {CONTEXT_ROWS.map((row) => (
                <div className="native-meter-row" key={row.key}>
                  <dt>
                    <span
                      className={`native-meter-swatch ${row.tint}`}
                      aria-hidden="true"
                    />
                    {row.label}
                  </dt>
                  <dd>~{formatTokens(breakdown[row.key])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </span>
  );
}
