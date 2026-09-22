/**
 * 引擎连接状态：主进程通信桥上报的断连/重连事件与手动重连入口。
 */
import { useCallback, useEffect, useState } from "react";

const qingwu = window.qingwu;

export function useEngineConnection() {
  /** 引擎连接状态（由主进程通信桥维护）。 */
  const [dshConnected, setDshConnected] = useState(true);
  /** 用户手动触发重连中。 */
  const [reconnecting, setReconnecting] = useState(false);

  // 监听引擎断连与重连状态
  useEffect(() => {
    qingwu
      .getDshConnectionStatus?.()
      .then((status) => {
        if (typeof status === "boolean") setDshConnected(status);
      })
      .catch(() => {});
    const cleanup = qingwu.onDshConnectionChanged?.((connected) => {
      setDshConnected(connected);
      if (connected) setReconnecting(false);
    });
    return () => cleanup?.();
  }, [qingwu]);

  const handleManualReconnect = useCallback(async () => {
    if (reconnecting) return;
    setReconnecting(true);
    try {
      await qingwu.reconnectDsh?.();
    } catch (err) {
      console.error("[qingwu] 重连引擎失败:", err);
    }
    window.setTimeout(() => {
      setReconnecting(false);
    }, 3000);
  }, [qingwu, reconnecting]);

  return { dshConnected, reconnecting, handleManualReconnect };
}
