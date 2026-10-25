import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import type {
  ScheduleCatalogEntry,
  ScheduleDeliveryRecord,
  ScheduleDeliveryHistoryResult,
  ScheduleTimingChange,
  SessionSummary,
} from "./protocol";
import { sessionTitle } from "./sidebar-data";
import type { PanelWidth } from "./usePanelWidth";
import { useScheduleTasks } from "./useScheduleTasks";

export interface ScheduleTasksPageProps {
  onBack: () => void;
  /** 侧栏宽度控制器：与主界面侧栏共用同一实例，宽度与拖拽互相联动。 */
  sidebarPanel: PanelWidth;
  dshConnected?: boolean;
  /** 会话列表快照：用于解析任务所属会话标题。 */
  sessions?: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  /** 空态引导：新开会话并预填定时任务示例指令。 */
  onCreateInChat: () => void;
}

/** 频率摘要：after/at 归为单次；cron 展示表达式，其余按本地时间展示。 */
function frequencyLabel(entry: ScheduleCatalogEntry, t: ReturnType<typeof useT>): string {
  switch (entry.kind) {
    case "after":
    case "at":
      return t("schedule.frequency.once");
    case "every": {
      const minutes = Math.round(entry.everySeconds / 60);
      return minutes >= 60 && minutes % 60 === 0
        ? t("schedule.frequency.everyHours", { count: minutes / 60 })
        : t("schedule.frequency.everyMinutes", { count: Math.max(1, minutes) });
    }
    case "daily":
      return t("schedule.frequency.daily", { time: entry.time.slice(0, 5) });
    case "weekly":
      return t("schedule.frequency.weekly", {
        days: entry.weekdays
          .slice()
          .sort((a, b) => a - b)
          .map((d) => t(`schedule.weekday.${d}`))
          .join(" "),
        time: entry.time.slice(0, 5),
      });
    case "cron":
      return t("schedule.frequency.cron", { expression: entry.expression });
  }
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** 可编辑的时间草稿；after 与 cron 第一版只读（仍可改标题与指令）。 */
type TimingDraft =
  | { kind: "at"; localDateTime: string }
  | { kind: "every"; minutes: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; weekdays: number[] }
  | { kind: "readonly" };

function localDateTimeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initialTiming(entry: ScheduleCatalogEntry): TimingDraft {
  switch (entry.kind) {
    case "after":
    case "cron":
      return { kind: "readonly" };
    case "at":
      return { kind: "at", localDateTime: localDateTimeOf(entry.scheduledAt) };
    case "every":
      return { kind: "every", minutes: String(Math.max(1, Math.round(entry.everySeconds / 60))) };
    case "daily":
      return { kind: "daily", time: entry.time.slice(0, 5) };
    case "weekly":
      return { kind: "weekly", time: entry.time.slice(0, 5), weekdays: entry.weekdays.slice() };
  }
}

function buildTimingChange(draft: TimingDraft): ScheduleTimingChange | { error: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  switch (draft.kind) {
    case "readonly":
      return { error: "readonly" };
    case "at": {
      if (!draft.localDateTime) return { error: "at-required" };
      const date = new Date(draft.localDateTime);
      if (Number.isNaN(date.getTime())) return { error: "at-invalid" };
      return { kind: "at", at: date.toISOString() };
    }
    case "every": {
      const minutes = Math.round(Number(draft.minutes));
      if (!Number.isFinite(minutes) || minutes < 1) return { error: "every-invalid" };
      return { kind: "every", every_seconds: minutes * 60 };
    }
    case "daily": {
      if (!/^\d{2}:\d{2}$/.test(draft.time)) return { error: "time-invalid" };
      return { kind: "daily", daily: { time: `${draft.time}:00`, time_zone: timeZone } };
    }
    case "weekly": {
      if (!/^\d{2}:\d{2}$/.test(draft.time)) return { error: "time-invalid" };
      if (draft.weekdays.length === 0) return { error: "weekdays-required" };
      return {
        kind: "weekly",
        weekly: { time: `${draft.time}:00`, time_zone: timeZone, weekdays: draft.weekdays.slice().sort((a, b) => a - b) },
      };
    }
  }
}

const WEEKDAY_KEYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function ScheduleTasksPage({
  onBack,
  sidebarPanel,
  dshConnected,
  sessions,
  onOpenSession,
  onCreateInChat,
}: ScheduleTasksPageProps) {
  const t = useT();
  const tasks = useScheduleTasks(true, dshConnected);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return tasks.entries.slice().sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return a.scheduledAt.localeCompare(b.scheduledAt);
    });
  }, [tasks.entries]);

  const selected = useMemo(
    () => sorted.find((e) => e.id === selectedId) ?? null,
    [sorted, selectedId],
  );

  // Esc 返回主界面（与设置页一致）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  const sessionName = (sessionId: string): string => {
    const summary = sessions?.find((s) => s.sessionId === sessionId);
    return summary ? sessionTitle(summary, t("sidebar.untitled")) : t("schedule.task.sourceSession");
  };

  return (
    <div className="native-settings-page native-schedule-page" aria-label={t("schedule.page.ariaLabel")}>
      <aside
        className="native-sidebar native-settings-rail"
        style={{ width: sidebarPanel.width }}
      >
        <button
          type="button"
          className="native-settings-back-btn"
          onClick={onBack}
          title={t("settings.page.backTitle")}
        >
          <span className="native-settings-nav-icon">
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 8H2M6.5 3.5L2 8l4.5 4.5" />
            </svg>
          </span>
          <span>{t("settings.page.back")}</span>
        </button>
        <div className="native-sidebar-section">
          <div className="native-sidebar-section-header">
            <span className="native-sidebar-section-title">
              {t("schedule.page.title")}
            </span>
          </div>
          <p className="native-schedule-note">{t("schedule.page.note")}</p>
        </div>
      </aside>

      <div
        className="native-resizer"
        role="separator"
        aria-orientation="vertical"
        title={t("settings.page.resizeHint")}
        onPointerDown={(e) => sidebarPanel.startDrag(e, 1)}
        onDoubleClick={sidebarPanel.reset}
      />

      <main className="native-chat native-settings-content">
        {tasks.loading && tasks.entries.length === 0 ? (
          <div className="native-schedule-loading">{t("schedule.list.loading")}</div>
        ) : tasks.loadError && tasks.entries.length === 0 ? (
          <div className="native-schedule-empty">
            <p>{tasks.loadError}</p>
            <button type="button" className="native-btn" onClick={() => void tasks.refresh()}>
              {t("schedule.list.retry")}
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="native-schedule-empty">
            <div className="native-schedule-empty-icon">
              <svg
                viewBox="0 0 24 24"
                width="28"
                height="28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div className="native-schedule-empty-title">{t("schedule.empty.title")}</div>
            <p className="native-schedule-empty-desc">{t("schedule.empty.desc")}</p>
            <button type="button" className="native-btn" onClick={onCreateInChat}>
              {t("schedule.empty.createInChat")}
            </button>
          </div>
        ) : (
          <div className="native-schedule-list">
            {sorted.map((entry) => (
              <ScheduleTaskRow
                key={entry.id}
                entry={entry}
                expanded={entry.id === selectedId}
                sessionLabel={sessionName(entry.sessionId)}
                frequency={frequencyLabel(entry, t)}
                onToggle={() =>
                  setSelectedId((prev) => (prev === entry.id ? null : entry.id))
                }
                onOpenSession={() => onOpenSession(entry.sessionId)}
              />
            ))}
            {selected && (
              <ScheduleTaskDetail
                key={selected.id}
                entry={selected}
                tasks={tasks}
                sessionLabel={sessionName(selected.sessionId)}
                onOpenSession={() => onOpenSession(selected.sessionId)}
                onDeleted={() => setSelectedId(null)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ScheduleTaskRow({
  entry,
  expanded,
  frequency,
  sessionLabel,
  onToggle,
  onOpenSession,
}: {
  entry: ScheduleCatalogEntry;
  expanded: boolean;
  frequency: string;
  sessionLabel: string;
  onToggle: () => void;
  onOpenSession: () => void;
}) {
  const t = useT();
  const inactive = entry.status !== "active";
  return (
    <button
      type="button"
      className={`native-schedule-row${expanded ? " expanded" : ""}${inactive ? " ended" : ""}`}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <div className="native-schedule-row-main">
        <span className="native-schedule-row-title">{entry.title}</span>
        <span className="native-schedule-row-freq">{frequency}</span>
      </div>
      <div className="native-schedule-row-meta">
        <span
          className={`native-schedule-row-status${inactive ? " ended" : ""}`}
        >
          {inactive ? t("schedule.task.ended") : t("schedule.task.active")}
        </span>
        <span className="native-schedule-row-next">
          {inactive
            ? t("schedule.task.ended")
            : `${t("schedule.task.nextRun")} ${formatDateTime(entry.scheduledAt)}`}
        </span>
        <span
          className="native-schedule-row-session"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSession();
          }}
          title={t("schedule.task.openSession")}
        >
          {sessionLabel}
        </span>
      </div>
    </button>
  );
}

function ScheduleTaskDetail({
  entry,
  tasks,
  sessionLabel,
  onOpenSession,
  onDeleted,
}: {
  entry: ScheduleCatalogEntry;
  tasks: ReturnType<typeof useScheduleTasks>;
  sessionLabel: string;
  onOpenSession: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(entry.title);
  const [prompt, setPrompt] = useState(entry.prompt);
  const [timing, setTiming] = useState<TimingDraft>(() => initialTiming(entry));
  const [timingTouched, setTimingTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<ScheduleDeliveryRecord[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const save = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const patch: { title?: string; prompt?: string; change?: ScheduleTimingChange } = {};
      const nextTitle = title.trim();
      if (!nextTitle) throw new Error(t("schedule.errors.titleRequired"));
      if (nextTitle !== entry.title) patch.title = nextTitle;
      if (prompt.trim() !== entry.prompt) patch.prompt = prompt.trim();
      if (timingTouched && timing.kind !== "readonly") {
        const change = buildTimingChange(timing);
        if ("error" in change) throw new Error(t(`schedule.errors.${change.error}`));
        patch.change = change;
      }
      if (patch.title === undefined && patch.prompt === undefined && patch.change === undefined) {
        return;
      }
      await tasks.updateTask(entry, patch);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      // compare-and-set 冲突或任务被外部改动：重读目录，让列表回到真实状态
      await tasks.refresh();
      return;
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await tasks.deleteTask(entry);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      await tasks.refresh();
    } finally {
      setSaving(false);
    }
  };

  const loadHistory = async () => {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const result: ScheduleDeliveryHistoryResult = await tasks.loadHistory(entry);
      setHistory(result.records);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="native-schedule-detail">
      <div className="native-schedule-detail-head">
        <span className="native-schedule-detail-session" onClick={onOpenSession}>
          {t("schedule.task.sourceSession")}：{sessionLabel}
        </span>
        <button
          type="button"
          className="native-schedule-history-toggle"
          onClick={() => {
            if (history === null) void loadHistory();
            else setHistory(null);
          }}
        >
          {history === null ? t("schedule.history.show") : t("schedule.history.hide")}
        </button>
      </div>

      {history !== null && (
        <div className="native-schedule-history">
          {historyLoading ? (
            <div>{t("schedule.history.loading")}</div>
          ) : history.length === 0 ? (
            <div>{t("schedule.history.empty")}</div>
          ) : (
            <ul>
              {history.map((record) => (
                <li key={`${record.messageId}-${record.scheduledAt}`}>
                  <span>{formatDateTime(record.deliveredAt)}</span>
                  <span className="native-schedule-history-planned">
                    {t("schedule.history.plannedAt", {
                      time: formatDateTime(record.scheduledAt),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="native-schedule-field">
        <span>{t("schedule.task.titleLabel")}</span>
        <input
          className="native-settings-input"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="native-schedule-field">
        <span>{t("schedule.task.promptLabel")}</span>
        <textarea
          className="native-settings-input native-schedule-prompt"
          value={prompt}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <div className="native-schedule-field">
        <span>{t("schedule.task.timingLabel")}</span>
        {timing.kind === "readonly" ? (() => {
          const label =
            entry.kind === "after"
              ? t("schedule.frequency.afterOnce", {
                  count: Math.max(1, Math.round(entry.afterSeconds / 60)),
                })
              : entry.kind === "cron"
                ? t("schedule.frequency.cron", { expression: entry.expression })
                : "";
          return (
          <div className="native-schedule-timing-readonly">
            {label}
            <span className="native-schedule-timing-hint">
              {t("schedule.task.timingReadonly")}
            </span>
          </div>
          );
        })() : timing.kind === "at" ? (
          <input
            className="native-settings-input native-schedule-timing-input"
            type="datetime-local"
            value={timing.localDateTime}
            onChange={(e) => {
              setTiming({ kind: "at", localDateTime: e.target.value });
              setTimingTouched(true);
            }}
          />
        ) : timing.kind === "every" ? (
          <div className="native-schedule-timing-inline">
            <input
              className="native-settings-input native-schedule-timing-input"
              type="number"
              min={1}
              value={timing.minutes}
              onChange={(e) => {
                setTiming({ kind: "every", minutes: e.target.value });
                setTimingTouched(true);
              }}
            />
            <span>{t("schedule.task.minutesUnit")}</span>
          </div>
        ) : (
          <div className="native-schedule-timing-inline">
            <input
              className="native-settings-input native-schedule-timing-input"
              type="time"
              value={timing.time}
              onChange={(e) => {
                setTiming((prev) =>
                  prev.kind === "daily" || prev.kind === "weekly"
                    ? { ...prev, time: e.target.value }
                    : prev,
                );
                setTimingTouched(true);
              }}
            />
            {timing.kind === "weekly" && (
              <div className="native-schedule-weekdays">
                {WEEKDAY_KEYS.map((day) => {
                  const on = timing.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`native-schedule-weekday${on ? " on" : ""}`}
                      onClick={() => {
                        setTiming((prev) => {
                          if (prev.kind !== "weekly") return prev;
                          const next = prev.weekdays.includes(day)
                            ? prev.weekdays.filter((d) => d !== day)
                            : [...prev.weekdays, day];
                          return { ...prev, weekdays: next };
                        });
                        setTimingTouched(true);
                      }}
                    >
                      {t(`schedule.weekday.${day}`)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {actionError && <div className="native-schedule-error">{actionError}</div>}

      <div className="native-schedule-actions">
        {!confirmDelete ? (
          <>
            <button
              type="button"
              className="native-btn"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? t("schedule.task.saving") : t("schedule.task.save")}
            </button>
            <button
              type="button"
              className="native-schedule-delete-btn"
              disabled={saving}
              onClick={() => setConfirmDelete(true)}
            >
              {t("schedule.task.delete")}
            </button>
          </>
        ) : (
          <div className="native-schedule-confirm">
            <span className="native-schedule-confirm-text">
              {t("schedule.task.deleteConfirm")}
            </span>
            <button type="button" className="native-btn" onClick={() => setConfirmDelete(false)}>
              {t("schedule.task.cancel")}
            </button>
            <button
              type="button"
              className="native-schedule-delete-btn"
              disabled={saving}
              onClick={() => void remove()}
            >
              {t("schedule.task.confirmDelete")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
