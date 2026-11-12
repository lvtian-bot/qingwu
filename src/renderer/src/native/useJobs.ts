import { useCallback, useEffect, useState } from "react";
import { Endpoints, type JobRow, type JobListFrame } from "./protocol";
import { rpc } from "./rpc";
const qingwu = window.qingwu;

export interface JobsState {
  jobs: JobRow[];
  loading: boolean;
  loadError: string | null;
  killJob: (sessionId: string, jobId: string) => Promise<boolean>;
}

export function useSessionJobs(sessionId: string | null): JobsState {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setJobs([]);
      setLoading(false);
      return;
    }

    let disposed = false;
    let streamId: string | null = null;

    setLoading(true);
    qingwu.dshStreamOpen(Endpoints.jobList, { request: { sessionId } })
      .then((id) => {
        if (disposed) {
          qingwu.dshStreamCancel(id);
          return;
        }
        streamId = id;
      })
      .catch((err) => {
        if (!disposed) setLoadError(String(err));
      });

    const unsubscribe = qingwu.onDshStreamItem(({ streamId: id, endpoint, value }) => {
      if (disposed || id !== streamId || endpoint !== Endpoints.jobList) return;
      const frame = value as JobListFrame;
      if (frame.type === 'rows') {
        setJobs(frame.jobs);
        setLoading(false);
      }
    });

    return () => {
      disposed = true;
      if (streamId) qingwu.dshStreamCancel(streamId);
      unsubscribe();
    };
  }, [sessionId]);

  const killJob = useCallback(async (sessionId: string, jobId: string) => {
    const result = await rpc<{ outcome: string }>(Endpoints.jobKill, {
      request: { sessionId, jobId }
    });
    return result.outcome === 'requested';
  }, []);

  return { jobs, loading, loadError, killJob };
}
