import { useCallback, useEffect, useState } from "react";
import { Endpoints } from "./protocol";
import { rpc } from "./rpc";
// dsh-jobs 的 wire 类型定义
export interface JobRow {
  id: string;
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed';
  kind: string;
  label: string;
  detail?: string;
  progress?: string;
  startedAt: number;
  finishedAt?: number;
  output: { total: number };
}

export interface JobsState {
  jobs: JobRow[];
  loading: boolean;
  loadError: string | null;
  killJob: (jobId: string) => Promise<boolean>;
}

export function useJobs(dshConnected: boolean | undefined): JobsState {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await rpc<JobRow[]>(Endpoints.jobList, {});
      setJobs(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dshConnected === false) return;
    refresh();
    // 简单轮询刷新列表
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [dshConnected, refresh]);

  const killJob = useCallback(async (jobId: string) => {
    const result = await rpc<{ ok: boolean }>(Endpoints.jobKill, { jobId });
    if (result.ok) {
        await refresh();
        return true;
    }
    return false;
  }, [refresh]);

  return { jobs, loading, loadError, killJob };
}
