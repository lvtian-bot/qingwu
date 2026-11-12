import { useState, useMemo, useRef, useEffect } from "react";
import { useSessionJobs } from "./useJobs";
import { useT } from "../i18n";
import "./job-panel.css";

export function JobListPopover({ sessionId }: { sessionId: string | null }) {
  const t = useT();
  const { jobs, killJob } = useSessionJobs(sessionId);
  const [open, setOpen] = useState(false);
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
  const [killStates, setKillStates] = useState<Record<string, 'armed' | 'pending' | 'failed'>>({});
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const ongoing = useMemo(() => jobs.filter(j => j.status === 'running' || j.status === 'stopping'), [jobs]);
  const settled = useMemo(() => jobs.filter(j => 
    (j.status === 'completed' || j.status === 'failed' || j.status === 'killed') && !clearedKeys.has(j.id)
  ), [jobs, clearedKeys]);

  const formatDuration = (start: number, end?: number) => {
    const diff = (end || Date.now()) - start;
    const s = Math.floor(diff / 1000);
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const handleKill = async (jobId: string) => {
    if (!sessionId) return;
    if (killStates[jobId] !== 'armed') {
      setKillStates({ ...killStates, [jobId]: 'armed' });
      setTimeout(() => {
        setKillStates(prev => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
      }, 3000);
      return;
    }
    
    setKillStates({ ...killStates, [jobId]: 'pending' });
    try {
      const ok = await killJob(sessionId, jobId);
      if (!ok) throw new Error("Failed");
    } catch {
      setKillStates({ ...killStates, [jobId]: 'failed' });
    }
  };

  if (jobs.length === 0) return null;

  return (
    <div style={{ position: 'relative' }} ref={popoverRef}>
      <button className="native-job-list-trigger" onClick={() => setOpen(!open)}>
        <span>{ongoing.length > 0 ? ongoing.length : jobs.length} 个后台任务</span>
      </button>

      {open && (
        <div className="native-job-list-popover">
          {ongoing.length > 0 && <div className="section-header">进行中</div>}
          {ongoing.map(job => (
            <div key={job.id} className="native-job-item">
              <div>
                <div className="native-job-label">{job.label}</div>
                <div className="native-job-status">{t(`chat.jobs.status.${job.status}` as any)} · {formatDuration(job.startedAt)}</div>
              </div>
              <button onClick={() => handleKill(job.id)} className={killStates[job.id] === 'failed' ? 'failed' : ''}>
                {killStates[job.id] === 'armed' ? "确认停止" : "停止"}
              </button>
            </div>
          ))}
          {settled.length > 0 && (
            <>
              <div className="section-header">
                <span>已结束 ({settled.length})</span>
                <button onClick={() => setClearedKeys(new Set(jobs.map(j => j.id)))}>清空</button>
              </div>
              {settled.map(job => (
                <div key={job.id} className="native-job-item settled">
                  <div>
                    <div className="native-job-label">{job.label}</div>
                    <div className="native-job-status">{t(`chat.jobs.status.${job.status}` as any)}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
