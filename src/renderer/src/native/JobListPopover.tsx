import { useState } from "react";
import { useJobs } from "./useJobs";
import "./job-panel.css";

export function JobListPopover({ dshConnected }: { dshConnected: boolean | undefined }) {
  const { jobs, killJob } = useJobs(dshConnected);
  const [open, setOpen] = useState(false);

  const runningJobs = jobs.filter(j => j.status === 'running' || j.status === 'stopping');
  
  if (jobs.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button className="native-job-list-trigger" onClick={() => setOpen(!open)}>
        <span>{runningJobs.length} 个后台任务{runningJobs.length > 0 ? '运行中' : ''}</span>
      </button>

      {open && (
        <div className="native-job-list-popover">
          {jobs.map(job => (
            <div key={job.id} className="native-job-item">
              <div className="native-job-info">
                <span className="native-job-label">{job.label}</span>
                <span className="native-job-status">{job.status}</span>
              </div>
              {job.status === 'running' && (
                <button onClick={() => killJob(job.id)}>停止</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
