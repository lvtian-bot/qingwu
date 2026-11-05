/**
 * 定时任务目录（schedule/catalog）与编辑/暂停/删除/批量清理/历史的 RPC 封装。
 *
 * 引擎 0.2.2 起，单个任务的修改与删除合为 schedule/edit（以 action 区分），
 * 并发保护由 expectedUpdatedAt 版本号承担；另提供宿主级的「清除全部已结束任务」。
 *
 * 引擎的 schedule/changed 事件不经当前桥接层转发，列表以「打开页面拉取 +
 * 每次操作成功后重拉」保持新鲜；重连后由边沿触发刷新。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import type {
  ScheduleCatalogEntry,
  ScheduleDeliveryHistoryResult,
  ScheduleDeleteInactiveResult,
  ScheduleEditRequest,
  ScheduleEditResult,
  SchedulePatch,
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
   * 编辑任务（版本号 compare-and-set）：expectedUpdatedAt 必须是编辑开始时
   * 读到的版本号，而非最新目录项——否则外部改动会被新版本吸收，比较失去
   * 保护。冲突与校验失败以异常抛出，由调用方提示并重读。
   * 成功返回引擎落库后的目录项，调用方应以其为新基线（不能等目录刷新，
   * 刷新可能失败或混入外部改动）。
   */
  updateTask: (
    expectedUpdatedAt: string | null,
    patch: SchedulePatch,
    id: string,
  ) => Promise<ScheduleCatalogEntry>;
  /** 暂停（active=false）或恢复（active=true）任务，规则同官方界面。 */
  setActive: (entry: ScheduleCatalogEntry, active: boolean) => Promise<ScheduleCatalogEntry>;
  /** 删除任务；目录随后重拉。 */
  deleteTask: (id: string, expectedUpdatedAt: string | null) => Promise<void>;
  /** 清除全部已结束任务，返回实际清除数量。 */
  deleteInactive: () => Promise<number>;
  /** 拉取运行历史（最近一页）。 */
  loadHistory: (entry: ScheduleCatalogEntry) => Promise<ScheduleDeliveryHistoryResult>;
}

/** 引擎把未命中/冲突/校验失败作为正常返回值（{code}），RPC 信封仍是成功。 */
class ScheduleEditRejected extends Error {
  constructor(readonly code: string) {
    super(`schedule edit rejected: ${code}`);
  }
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

  /** 统一的 edit 调用：不检查 code 会把未生效的操作当成成功。 */
  const edit = useCallback(
    async (request: ScheduleEditRequest): Promise<ScheduleEditResult> => {
      const result = await rpc<ScheduleEditResult>(Endpoints.scheduleEdit, {
        request,
      });
      if ("code" in result && typeof result.code === "string") {
        throw new ScheduleEditRejected(result.code);
      }
      return result;
    },
    [],
  );

  const updateTask = useCallback(
    async (
      expectedUpdatedAt: string | null,
      patch: SchedulePatch,
      id: string,
    ): Promise<ScheduleCatalogEntry> => {
      const result = await edit({
        id,
        action: "update",
        patch,
        expectedUpdatedAt,
      });
      if ("id" in result && "status" in result) {
        void refresh();
        return result;
      }
      // 只有删除回执会落到这里，说明引擎返回了与请求不符的结果
      throw new Error(t("schedule.errors.updateRejected", { code: "unknown" }));
    },
    [edit, refresh, t],
  );

  const setActive = useCallback(
    (entry: ScheduleCatalogEntry, nextActive: boolean) =>
      // 版本号取目录项的 updatedAt：暂停/恢复通常不在编辑详情里进行
      updateTask(entry.updatedAt ?? null, { active: nextActive }, entry.id),
    [updateTask],
  );

  const deleteTask = useCallback(
    async (id: string, expectedUpdatedAt: string | null) => {
      try {
        await edit({ id, action: "delete", expectedUpdatedAt });
      } catch (err) {
        // schedule_not_found 只在任务已不存在时出现，对删除语义视为收敛成功
        if (!(err instanceof ScheduleEditRejected) || err.code !== "schedule_not_found") {
          const code = err instanceof ScheduleEditRejected ? err.code : "unknown";
          throw new Error(t("schedule.errors.deleteRejected", { code }));
        }
      }
      await refresh();
    },
    [edit, refresh, t],
  );

  const deleteInactive = useCallback(async () => {
    const result = await rpc<ScheduleDeleteInactiveResult>(
      Endpoints.scheduleDeleteInactive,
      {},
    );
    await refresh();
    return result.deleted;
  }, [refresh]);

  const loadHistory = useCallback(
    (entry: ScheduleCatalogEntry) =>
      rpc<ScheduleDeliveryHistoryResult>(Endpoints.scheduleHistory, {
        request: { id: entry.id, limit: 20 },
      }),
    [],
  );

  return {
    entries,
    loading,
    loadError,
    refresh,
    updateTask,
    setActive,
    deleteTask,
    deleteInactive,
    loadHistory,
  };
}
