import { useState } from "react";
import { useJobs } from "./useJobs";
import { useT } from "../i18n";
import "./job-panel.css";

export function JobListPopover({ dshConnected }: { dshConnected: boolean | undefined }) {
  const t = useT();
  const { jobs, killJob } = useJobs(dshConnected);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runningJobs = jobs.filter(j => j.status === 'running' || j.status === 'stopping');
  
  if (jobs.length === 0) return null;

  const handleKill = async (jobId: string) => {
    try {
      const ok = await killJob(jobId);
      if (!ok) throw new Error("Kill failed");
    } catch (e) {
      setError(t("chat.jobs.stopFailed"));
      setTimeout(() => setError(null), 3000);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="native-job-list-trigger" onClick={() => setOpen(!open)}>
        <span>{runningJobs.length > 0 
            ? t("chat.jobs.running", { count: runningJobs.length }) 
            : t("chat.jobs.idle", { count: jobs.length })}
        </span>
      </button>

      {open && (
        <div className="native-job-list-popover">
          {error && <div style={{ color: 'red', fontSize: '12px', padding: '4px' }}>{error}</div>}
          {jobs.map(job => (
            <div key={job.id} className="native-job-item">
              <div className="native-job-info">
                <span className="native-job-label">{job.label}</span>
                <span className="native-job-status">{t(`chat.jobs.status.${job.status}` as any)}</span>
              </div>
              {job.status === 'running' && (
                <button onClick={() => handleKill(job.id)}>{t("chat.jobs.stop")}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
