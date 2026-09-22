/**
 * 底部运行状态条：对齐官方「工作中 X 秒」的轻量文字提示（仅运行中挂载）。
 * 计时起点由父级传入（最近一次 turn/start 的事件时间），每秒走一次表。
 */
import { useEffect, useState } from "react";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes} 分 ${seconds} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分 ${seconds} 秒`;
}

export function RunningStrip({ startedAt }: { startedAt: number | null }) {
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
      <span className="native-running-strip-label">工作中</span>
      <span className="native-running-strip-time">{formatElapsed(elapsed)}</span>
    </div>
  );
}
