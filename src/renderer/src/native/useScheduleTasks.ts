/**
 * 定时任务目录（schedule/catalog）与编辑/删除/历史的 RPC 封装。
 *
 * 引擎的 schedule/changed 事件不经当前桥接层转发，列表以「打开页面拉取 +
 * 每次操作成功后重拉」保持新鲜；重连后由边沿触发刷新。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import type {
  ScheduleCatalogEntry,
  ScheduleDeleteResult,
  ScheduleDeliveryHistoryResult,
  ScheduleRecord,
  ScheduleTimingChange,
  ScheduleUpdateRequest,
  ScheduleUpdateResult,
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
   * 编辑任务（compare-and-set）：expected 必须是编辑开始时的基线记录，而非
   * 最新目录项——否则外部改动会被新基线吸收，比较失去保护。冲突与校验失败
   * 以 code 抛出（引擎把失败作为返回值而不是 RPC 错误），由调用方提示并重读。
   * 成功返回引擎落库后的记录，调用方应以其为新基线（不能等目录刷新，
   * 刷新可能失败或混入外部改动）。
   */
  updateTask: (
    sessionId: string,
    expected: ScheduleRecord,
    patch: { title?: string; prompt?: string; change?: ScheduleTimingChange },
  ) => Promise<ScheduleRecord>;
  /** 删除任务；目录随后重拉。 */
  deleteTask: (sessionId: string, id: string) => Promise<void>;
  /** 拉取运行历史（最近一页）。 */
  loadHistory: (
    entry: ScheduleCatalogEntry,
  ) => Promise<ScheduleDeliveryHistoryResult>;
}

export function useScheduleTasks(
  active: boolean,
  dshConnected: boolean | undefined,
): ScheduleTasksState {
  const t = useT();
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
      sessionId: string,
      expected: ScheduleRecord,
      patch: { title?: string; prompt?: string; change?: ScheduleTimingChange },
    ) => {
      const request: ScheduleUpdateRequest = {
        sessionId,
        id: expected.id,
        expected,
        ...patch,
      };
      // 引擎把未命中/冲突/校验失败作为正常返回值（{code}），RPC 信封仍是成功；
      // 不检查会把未生效的保存当成功
      const result = await rpc<ScheduleUpdateResult>(
        Endpoints.scheduleUpdate,
        { request },
      );
      if (!("updated" in result) || result.updated !== true) {
        const code = "code" in result ? result.code : "unknown";
        throw new Error(t("schedule.errors.updateRejected", { code }));
      }
      void refresh();
      return result.record;
    },
    [refresh, t],
  );

  const deleteTask = useCallback(
    async (sessionId: string, id: string) => {
      const result = await rpc<ScheduleDeleteResult>(
        Endpoints.scheduleDelete,
        { request: { sessionId, id } },
      );
      // deleted:false 仅在任务已不存在时出现，对删除语义视为收敛成功
      if (!("deleted" in result) || result.deleted !== true) {
        if (!("code" in result) || result.code !== "schedule_not_found") {
          throw new Error(t("schedule.errors.deleteRejected"));
        }
      }
      await refresh();
    },
    [refresh, t],
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
