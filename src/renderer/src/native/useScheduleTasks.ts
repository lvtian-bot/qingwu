/**
 * 定时任务目录（schedule/catalog）与编辑/删除/历史的 RPC 封装。
 *
 * 引擎的 schedule/changed 事件不经当前桥接层转发，列表以「打开页面拉取 +
 * 每次操作成功后重拉」保持新鲜；重连后由边沿触发刷新。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ScheduleCatalogEntry,
  ScheduleDeliveryHistoryResult,
  ScheduleRecord,
  ScheduleTimingChange,
  ScheduleUpdateRequest,
} from "./protocol";
import { Endpoints } from "./protocol";
import { rpc } from "./rpc";

export interface ScheduleTasksState {
  entries: ScheduleCatalogEntry[];
  loading: boolean;
  loadError: string | null;
  /** 重新拉取目录；操作成功与重连后调用。 */
  refresh: () => Promise<void>;
  /**
   * 编辑任务（compare-and-set）：携带编辑前记录，冲突（schedule_conflict）
   * 时引擎不写入，由调用方提示并重读。
   */
  updateTask: (
    entry: ScheduleCatalogEntry,
    patch: { title?: string; prompt?: string; change?: ScheduleTimingChange },
  ) => Promise<void>;
  /** 删除任务；目录随后重拉。 */
  deleteTask: (entry: ScheduleCatalogEntry) => Promise<void>;
  /** 拉取运行历史（最近一页）。 */
  loadHistory: (
    entry: ScheduleCatalogEntry,
  ) => Promise<ScheduleDeliveryHistoryResult>;
}

export function useScheduleTasks(
  active: boolean,
  dshConnected: boolean | undefined,
): ScheduleTasksState {
  const [entries, setEntries] = useState<ScheduleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 世代号：丢弃迟到的旧目录响应。 */
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    try {
      const value = await rpc<ScheduleCatalogEntry[]>(
        Endpoints.scheduleCatalog,
        {},
      );
      if (generation !== generationRef.current) return;
      setEntries(value);
      setLoadError(null);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, []);

  // 页面打开与连接状态变化时（重新）拉取；连接中断时跳过请求
  useEffect(() => {
    if (!active || dshConnected === false) return;
    void refresh();
  }, [active, dshConnected, refresh]);

  const updateTask = useCallback(
    async (
      entry: ScheduleCatalogEntry,
      patch: { title?: string; prompt?: string; change?: ScheduleTimingChange },
    ) => {
      // 目录项含会话归属与状态等扩展字段，expected 须回退为纯记录
      const { sessionId, status, lastDelivery, ...record } = entry;
      void status;
      void lastDelivery;
      const request: ScheduleUpdateRequest = {
        sessionId,
        id: entry.id,
        expected: record as ScheduleRecord,
        ...patch,
      };
      await rpc(Endpoints.scheduleUpdate, { request });
      await refresh();
    },
    [refresh],
  );

  const deleteTask = useCallback(
    async (entry: ScheduleCatalogEntry) => {
      await rpc(Endpoints.scheduleDelete, {
        request: { sessionId: entry.sessionId, id: entry.id },
      });
      await refresh();
    },
    [refresh],
  );

  const loadHistory = useCallback(
    (entry: ScheduleCatalogEntry) =>
      rpc<ScheduleDeliveryHistoryResult>(Endpoints.scheduleHistory, {
        request: { sessionId: entry.sessionId, id: entry.id, limit: 20 },
      }),
    [],
  );

  return { entries, loading, loadError, refresh, updateTask, deleteTask, loadHistory };
}
