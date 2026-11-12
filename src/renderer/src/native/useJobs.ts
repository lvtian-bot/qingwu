import { useCallback, useEffect, useState } from "react";
import {
  Endpoints,
  type JobFollowFrame,
  type JobKillValue,
  type JobListFrame,
  type JobRow,
} from "./protocol";
import { rpc, toErrMsg } from "./rpc";

const qingwu = window.qingwu;

/** 单个任务在展开面板中保留的末尾最大字符数（对齐官方 128KB 尾缓冲）。 */
const RENDER_TAIL_LIMIT = 128 * 1024;

export interface JobObservedOutput {
  jobId: string;
  text: string;
  gapBefore: boolean;
  streaming: boolean;
  error?: string;
}

export interface JobsState {
  jobs: JobRow[];
  loading: boolean;
  loadError: string | null;
  killJob: (sessionId: string, jobId: string) => Promise<boolean>;
}

/** 排序规则（对齐官方 dsh-client-ui-jobs）：运行中按启动时间正序在前，已结束按完成时间倒序在后。 */
export function orderJobs(jobs: readonly JobRow[]): JobRow[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = left.status === "running" || left.status === "stopping";
    const liveRight = right.status === "running" || right.status === "stopping";
    if (liveLeft !== liveRight) return liveLeft ? -1 : 1;
    if (liveLeft) return left.startedAt - right.startedAt;
    const finished =
      (right.finishedAt ?? right.startedAt) -
      (left.finishedAt ?? left.startedAt);
    return finished !== 0 ? finished : left.startedAt - right.startedAt;
  });
}

export function useSessionJobs(sessionId: string | null): JobsState {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // 切换会话时立即清空上一会话的任务列表，防止跨会话残留显示或误操作
    setJobs([]);
    setLoadError(null);

    if (!sessionId) {
      setLoading(false);
      return;
    }

    let disposed = false;
    let streamId: string | null = null;
    setLoading(true);

    const unsubscribe = qingwu.onDshStreamItem(
      ({ streamId: id, endpoint, value }) => {
        if (disposed || id !== streamId || endpoint !== Endpoints.jobList)
          return;
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (record.type === "stream/error") {
          const err = record.error as { message?: string } | undefined;
          setLoadError(err?.message ?? "stream error");
          setLoading(false);
          return;
        }
        if (record.type === "stream/end") {
          setLoading(false);
          return;
        }
        const frame = value as JobListFrame;
        if (frame.type === "rows" && Array.isArray(frame.jobs)) {
          setJobs(orderJobs(frame.jobs));
          setLoading(false);
        }
      },
    );

    qingwu
      .dshStreamOpen(Endpoints.jobList, { request: { sessionId } })
      .then((id) => {
        if (disposed) {
          qingwu.dshStreamCancel(id);
          return;
        }
        streamId = id;
      })
      .catch((err) => {
        if (!disposed) {
          setLoadError(toErrMsg(err));
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      if (streamId) qingwu.dshStreamCancel(streamId);
      unsubscribe();
    };
  }, [sessionId]);

  const killJob = useCallback(async (targetSessionId: string, jobId: string) => {
    const result = await rpc<JobKillValue>(Endpoints.jobKill, {
      request: { sessionId: targetSessionId, jobId },
    });
    return (
      result.outcome === "requested" || result.outcome === "already-finished"
    );
  }, []);

  return { jobs, loading, loadError, killJob };
}

/**
 * 按需订阅单条任务的实时输出流（job/follow）。
 * 仅在面板展开且用户点开某条可观察任务时建立连接，收起或关闭面板时立即取消流。
 */
export function useJobObservation(
  sessionId: string | null,
  jobId: string | null,
): JobObservedOutput | null {
  const [observed, setObserved] = useState<JobObservedOutput | null>(null);

  useEffect(() => {
    setObserved(null);
    if (!sessionId || !jobId) return;

    let disposed = false;
    let streamId: string | null = null;

    const unsubscribe = qingwu.onDshStreamItem(
      ({ streamId: id, endpoint, value }) => {
        if (disposed || id !== streamId || endpoint !== Endpoints.jobFollow)
          return;
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (record.type === "stream/error") {
          const err = record.error as { message?: string } | undefined;
          setObserved((prev) => ({
            jobId,
            text: prev?.text ?? "",
            gapBefore: prev?.gapBefore ?? false,
            streaming: false,
            error: err?.message ?? "stream error",
          }));
          return;
        }
        if (record.type === "stream/end") {
          setObserved((prev) =>
            prev ? { ...prev, streaming: false } : null,
          );
          return;
        }
        const frame = value as JobFollowFrame;
        if (frame.type === "opened") {
          setObserved({
            jobId,
            text: "",
            gapBefore: frame.from < frame.job.output.earliest || frame.from > 0,
            streaming: true,
          });
        } else if (frame.type === "output") {
          setObserved((prev) => {
            const baseText = prev?.text ?? "";
            let text =
              baseText + frame.chunks.map((chunk) => chunk.text).join("");
            let gapBefore =
              (prev?.gapBefore ?? false) ||
              frame.lossy === true ||
              frame.chunks.some((chunk) => chunk.gapBefore === true);
            if (text.length > RENDER_TAIL_LIMIT) {
              let cut = text.length - RENDER_TAIL_LIMIT;
              const unit = text.charCodeAt(cut);
              if (unit >= 0xdc00 && unit <= 0xdfff) cut += 1;
              text = text.slice(cut);
              gapBefore = true;
            }
            return {
              jobId,
              text,
              gapBefore,
              streaming: prev?.streaming ?? true,
              error: prev?.error,
            };
          });
        } else if (frame.type === "status") {
          setObserved((prev) =>
            prev ? { ...prev, streaming: false } : null,
          );
        }
      },
    );

    qingwu
      .dshStreamOpen(Endpoints.jobFollow, {
        request: { sessionId, jobId },
      })
      .then((id) => {
        if (disposed) {
          qingwu.dshStreamCancel(id);
          return;
        }
        streamId = id;
      })
      .catch((err) => {
        if (!disposed) {
          setObserved({
            jobId,
            text: "",
            gapBefore: false,
            streaming: false,
            error: toErrMsg(err),
          });
        }
      });

    return () => {
      disposed = true;
      if (streamId) qingwu.dshStreamCancel(streamId);
      unsubscribe();
    };
  }, [sessionId, jobId]);

  return observed;
}
