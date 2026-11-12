import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import type { JobRow } from "./protocol";
import { useJobObservation, useSessionJobs } from "./useJobs";
import "./job-panel.css";

function isLiveJob(job: JobRow): boolean {
  return job.status === "running" || job.status === "stopping";
}

function isObservableJob(job: JobRow): boolean {
  return isLiveJob(job) || job.output.total > 0;
}

export function JobListPopover({ sessionId }: { sessionId: string | null }) {
  const t = useT();
  const { jobs, killJob } = useSessionJobs(sessionId);
  const [open, setOpen] = useState(false);
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
  const [killStates, setKillStates] = useState<
    Record<string, "armed" | "pending" | "failed">
  >({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const popoverRef = useRef<HTMLDivElement>(null);

  // 切换会话时重置面板局部状态
  useEffect(() => {
    setOpen(false);
    setClearedKeys(new Set());
    setKillStates({});
    setExpandedId(null);
  }, [sessionId]);

  const ongoing = useMemo(
    () => jobs.filter((j) => isLiveJob(j)),
    [jobs],
  );
  const settled = useMemo(
    () =>
      jobs.filter(
        (j) => !isLiveJob(j) && !clearedKeys.has(j.id),
      ),
    [jobs, clearedKeys],
  );

  const visibleCount = ongoing.length + settled.length;

  useEffect(() => {
    if (visibleCount === 0 && open) {
      setOpen(false);
    }
  }, [visibleCount, open]);

  // 面板展开且存在进行中任务时，每秒刷新一次耗时显示
  useEffect(() => {
    if (!open || ongoing.length === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, ongoing.length]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  const expandedRow = useMemo(
    () =>
      open && expandedId
        ? jobs.find((j) => j.id === expandedId && isObservableJob(j)) ?? null
        : null,
    [open, expandedId, jobs],
  );

  const observed = useJobObservation(sessionId, expandedRow?.id ?? null);

  const formatDuration = (start: number, end?: number) => {
    const elapsedMs = Math.max(0, (end ?? now) - start);
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    if (hours > 0) {
      return t("chat.jobs.durationHours", { hours, minutes });
    }
    if (minutes > 0) {
      return t("chat.jobs.durationMinutes", { minutes, seconds });
    }
    return t("chat.jobs.durationSeconds", { seconds });
  };

  const handleKill = async (jobId: string) => {
    if (!sessionId) return;
    if (killStates[jobId] !== "armed") {
      setKillStates((prev) => ({ ...prev, [jobId]: "armed" }));
      setTimeout(() => {
        setKillStates((prev) => {
          if (prev[jobId] !== "armed") return prev;
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
      }, 3000);
      return;
    }

    setKillStates((prev) => ({ ...prev, [jobId]: "pending" }));
    try {
      const ok = await killJob(sessionId, jobId);
      if (!ok) throw new Error("Kill rejected");
      setKillStates((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    } catch {
      setKillStates((prev) => ({ ...prev, [jobId]: "failed" }));
      setTimeout(() => {
        setKillStates((prev) => {
          if (prev[jobId] !== "failed") return prev;
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
      }, 4000);
    }
  };

  const toggleExpand = (job: JobRow) => {
    if (!isObservableJob(job)) return;
    setExpandedId((prev) => (prev === job.id ? null : job.id));
  };

  const clearSettled = () => {
    setClearedKeys((prev) => {
      const next = new Set(prev);
      for (const job of settled) next.add(job.id);
      return next;
    });
    if (expandedId && settled.some((job) => job.id === expandedId)) {
      setExpandedId(null);
    }
  };

  if (visibleCount === 0) return null;

  const renderRow = (job: JobRow, isSettled: boolean) => {
    const killState = killStates[job.id];
    const expanded = expandedRow?.id === job.id;
    const statusText =
      job.progress ??
      job.detail ??
      t(`chat.jobs.status.${job.status}`);
    const durationText = formatDuration(
      job.startedAt,
      isLiveJob(job) ? undefined : job.finishedAt ?? job.startedAt,
    );

    return (
      <div
        key={job.id}
        className={`native-job-entry${isSettled ? " settled" : ""}`}
      >
        <div
          className="native-job-item"
          onClick={() => toggleExpand(job)}
        >
          <div className="native-job-info">
            <div className="native-job-label" title={job.label}>
              <span className="native-job-kind">{job.kind}</span>
              <span>{job.label}</span>
            </div>
            <div className="native-job-status">
              {statusText} · {durationText}
            </div>
          </div>
          {job.status === "running" && (
            <button
              type="button"
              disabled={killState === "pending"}
              onClick={(e) => {
                e.stopPropagation();
                void handleKill(job.id);
              }}
              className={`native-job-stop-btn${killState ? ` is-${killState}` : ""}`}
            >
              {killState === "armed"
                ? t("chat.jobs.confirmStop")
                : killState === "failed"
                  ? t("chat.jobs.stopFailed")
                  : t("chat.jobs.stop")}
            </button>
          )}
        </div>
        {expanded && observed && observed.jobId === job.id && (
          <div className="native-job-output-panel">
            {observed.gapBefore && (
              <div className="native-job-output-notice">
                {t("chat.jobs.outputGap")}
              </div>
            )}
            {observed.error && (
              <div className="native-job-output-notice is-error">
                {t("chat.jobs.outputError", { error: observed.error })}
              </div>
            )}
            <pre className="native-job-output-pre">
              {observed.text || t("chat.jobs.noOutput")}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="native-job-list-root" ref={popoverRef}>
      <button
        type="button"
        className="native-job-list-trigger"
        aria-expanded={open}
        onClick={() => {
          setNow(Date.now());
          setOpen((prev) => !prev);
        }}
      >
        {ongoing.length > 0 && <span className="native-job-live-dot" />}
        <span>
          {ongoing.length > 0
            ? t("chat.jobs.running", { count: ongoing.length })
            : t("chat.jobs.idle", { count: visibleCount })}
        </span>
      </button>

      {open && (
        <div className="native-job-list-popover">
          {ongoing.length > 0 && (
            <div className="section-header">{t("chat.jobs.sectionLive")}</div>
          )}
          {ongoing.map((job) => renderRow(job, false))}
          {settled.length > 0 && (
            <>
              <div className="section-header">
                <span>
                  {t("chat.jobs.sectionSettled", { count: settled.length })}
                </span>
                <button
                  type="button"
                  className="native-job-clear-btn"
                  onClick={clearSettled}
                >
                  {t("chat.jobs.clear")}
                </button>
              </div>
              {settled.map((job) => renderRow(job, true))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
