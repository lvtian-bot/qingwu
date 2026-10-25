import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import type {
  ScheduleCatalogEntry,
  ScheduleDeliveryRecord,
  ScheduleDeliveryHistoryResult,
  ScheduleRecord,
  ScheduleTimingChange,
  SessionSummary,
} from "./protocol";
import { sessionTitle } from "./sidebar-data";
import { useScheduleTasks } from "./useScheduleTasks";

export interface ScheduleTasksPageProps {
  /** 退出任务视图（Esc）：主内容区切回会话视图，不是覆盖层。 */
  onExit: () => void;
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

/** 可编辑的时间草稿；daily/weekly 保留任务原时区，避免编辑把它迁到系统时区；
 * after 与 cron 第一版只读（仍可改标题与指令）。 */
type TimingDraft =
  | { kind: "at"; localDateTime: string }
  | { kind: "every"; minutes: string }
  | { kind: "daily"; time: string; timeZone: string }
  | { kind: "weekly"; time: string; timeZone: string; weekdays: number[] }
  | { kind: "readonly" };

function localDateTimeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initialTiming(record: ScheduleRecord): TimingDraft {
  switch (record.kind) {
    case "after":
    case "cron":
      return { kind: "readonly" };
    case "at":
      return { kind: "at", localDateTime: localDateTimeOf(record.scheduledAt) };
    case "every":
      return { kind: "every", minutes: String(Math.max(1, Math.round(record.everySeconds / 60))) };
    case "daily":
      return { kind: "daily", time: record.time.slice(0, 5), timeZone: record.timeZone };
    case "weekly":
      return { kind: "weekly", time: record.time.slice(0, 5), timeZone: record.timeZone, weekdays: record.weekdays.slice() };
  }
}

function buildTimingChange(draft: TimingDraft): ScheduleTimingChange | { error: string } {
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
      return { kind: "daily", daily: { time: `${draft.time}:00`, time_zone: draft.timeZone } };
    }
    case "weekly": {
      if (!/^\d{2}:\d{2}$/.test(draft.time)) return { error: "time-invalid" };
      if (draft.weekdays.length === 0) return { error: "weekdays-required" };
      return {
        kind: "weekly",
        weekly: { time: `${draft.time}:00`, time_zone: draft.timeZone, weekdays: draft.weekdays.slice().sort((a, b) => a - b) },
      };
    }
  }
}

/** 目录项剔除会话归属与状态扩展字段，得到可作 compare-and-set 基线的纯记录。 */
function toRecord(entry: ScheduleCatalogEntry): ScheduleRecord {
  const { sessionId, status, lastDelivery, ...record } = entry;
  void sessionId;
  void status;
  void lastDelivery;
  return record as ScheduleRecord;
}

const WEEKDAY_KEYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function ScheduleTasksPage({
  onExit,
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

  // Esc 退出任务视图，主内容区切回会话
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  const sessionName = (sessionId: string): string => {
    const summary = sessions?.find((s) => s.sessionId === sessionId);
    return summary ? sessionTitle(summary, t("sidebar.untitled")) : t("schedule.task.sourceSession");
  };

  return (
    <div className="native-schedule-view" aria-label={t("schedule.page.ariaLabel")}>
      <div className="native-schedule-header">
        <div className="native-schedule-header-title">
          {t("schedule.page.title")}
        </div>
        <p className="native-schedule-note">{t("schedule.page.note")}</p>
      </div>
      <div className="native-schedule-body">
        {/* 刷新失败随时可见（含仍有缓存列表时），附重试；避免静默停留在过期数据上 */}
        {tasks.loadError && (
          <div className="native-schedule-refresh-error" role="alert">
            <span className="native-schedule-refresh-error-text">
              {tasks.loadError}
            </span>
            <button
              type="button"
              className="native-schedule-refresh-retry"
              onClick={() => void tasks.refresh()}
            >
              {t("schedule.list.retry")}
            </button>
          </div>
        )}
        {tasks.loading && tasks.entries.length === 0 ? (
          <div className="native-schedule-loading">{t("schedule.list.loading")}</div>
        ) : tasks.loadError && tasks.entries.length === 0 ? (
          /* 仅剩错误横幅：加载失败且无缓存时不显示空态引导，避免误导为没有任务 */
          null
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
              <Fragment key={entry.id}>
                <ScheduleTaskRow
                  entry={entry}
                  expanded={entry.id === selectedId}
                  sessionLabel={sessionName(entry.sessionId)}
                  frequency={frequencyLabel(entry, t)}
                  onToggle={() =>
                    setSelectedId((prev) => (prev === entry.id ? null : entry.id))
                  }
                  onOpenSession={() => onOpenSession(entry.sessionId)}
                />
                {/* 详情紧跟所属行展开：列表超出一屏时编辑区不会落在视野外 */}
                {entry.id === selectedId && (
                  <ScheduleTaskDetail
                    entry={entry}
                    tasks={tasks}
                    sessionLabel={sessionName(entry.sessionId)}
                    onOpenSession={() => onOpenSession(entry.sessionId)}
                    onDeleted={() => setSelectedId(null)}
                  />
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>
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
  /** timing 的最新值镜像：保存成功后判断请求期间用户是否又编辑过时间。 */
  const timingRef = useRef(timing);
  const [timingTouched, setTimingTouched] = useState(false);
  const updateTiming = useCallback(
    (next: TimingDraft | ((prev: TimingDraft) => TimingDraft)) => {
      setTiming((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        timingRef.current = value;
        return value;
      });
      setTimingTouched(true);
    },
    [],
  );
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<ScheduleDeliveryRecord[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** compare-and-set 基线：编辑开始时的记录，保存成功后以引擎返回的落库记录推进。
   * 不能等目录刷新再推进：刷新可能失败或混入外部改动，会把别人的修改当自己的结果。 */
  const [baseline, setBaseline] = useState<ScheduleRecord>(() => toRecord(entry));
  const [externalChange, setExternalChange] = useState(false);

  // 详情打开期间目录项变化：与基线不同即为外部改动，只提示，基线保持原值
  //（保存时与引擎比较必然冲突，由用户重开详情重新加载）。
  useEffect(() => {
    if (JSON.stringify(toRecord(entry)) !== JSON.stringify(baseline)) {
      setExternalChange(true);
    }
    // baseline 有意不入依赖：仅响应目录项引用变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const save = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const patch: { title?: string; prompt?: string; change?: ScheduleTimingChange } = {};
      const nextTitle = title.trim();
      if (!nextTitle) throw new Error(t("schedule.errors.titleRequired"));
      if (nextTitle !== baseline.title) patch.title = nextTitle;
      if (prompt.trim() !== baseline.prompt) patch.prompt = prompt.trim();
      if (timingTouched && timing.kind !== "readonly") {
        const change = buildTimingChange(timing);
        if ("error" in change) throw new Error(t(`schedule.errors.${change.error}`));
        patch.change = change;
      }
      if (patch.title === undefined && patch.prompt === undefined && patch.change === undefined) {
        return;
      }
      const submittedTiming = timingRef.current;
      // 以引擎落库记录推进基线：这是本次保存的确凿结果，与目录刷新成败无关
      const committed = await tasks.updateTask(entry.sessionId, baseline, patch);
      setBaseline(committed);
      setExternalChange(false);
      // 已提交的时间变更不再重发（重复提交会让周期任务重新起算）；请求期间又编辑过则保留待下次提交
      if (timingRef.current === submittedTiming) {
        const settled = initialTiming(committed);
        timingRef.current = settled;
        setTiming(settled);
        setTimingTouched(false);
      }
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
      await tasks.deleteTask(entry.sessionId, entry.id);
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
              updateTiming({ kind: "at", localDateTime: e.target.value });
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
                updateTiming({ kind: "every", minutes: e.target.value });
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
                updateTiming((prev) =>
                  prev.kind === "daily" || prev.kind === "weekly"
                    ? { ...prev, time: e.target.value }
                    : prev,
                );
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
                        updateTiming((prev) => {
                          if (prev.kind !== "weekly") return prev;
                          const next = prev.weekdays.includes(day)
                            ? prev.weekdays.filter((d) => d !== day)
                            : [...prev.weekdays, day];
                          return { ...prev, weekdays: next };
                        });
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

      {externalChange && !actionError && (
        <div className="native-schedule-external">
          {t("schedule.task.externalChanged")}
        </div>
      )}
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
