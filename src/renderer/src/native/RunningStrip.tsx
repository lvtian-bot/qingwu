/**
 * 底部运行状态条：对齐官方「工作中 X 秒」的轻量文字提示（仅运行中挂载）。
 * 计时起点由父级传入（最近一次 turn/start 的事件时间），每秒走一次表。
 */
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import type { Translate } from "../i18n/core";

function formatElapsed(ms: number, t: Translate): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60)
    return t("chat.strip.elapsedSeconds", { count: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60)
    return t("chat.strip.elapsedMinutes", { count: minutes, seconds });
  const hours = Math.floor(minutes / 60);
  return t("chat.strip.elapsedHours", {
    hours,
    minutes: minutes % 60,
    seconds,
  });
}

export function RunningStrip({ startedAt }: { startedAt: number | null }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 引擎事件时间与本地时钟的极小偏差可为负：钳到 0，不显示负数
  if (startedAt === null) return null;
  const elapsed = Math.max(0, now - startedAt);
  return (
    <div className="native-running-strip" role="status">
      <span className="native-running-strip-label">{t("chat.strip.working")}</span>
      <span className="native-running-strip-time">{formatElapsed(elapsed, t)}</span>
    </div>
  );
}
