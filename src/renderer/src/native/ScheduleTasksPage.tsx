import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import type {
  ScheduleCatalogEntry,
  ScheduleDeliveryRecord,
  ScheduleDeliveryHistoryResult,
  SchedulePatch,
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

/**
 * 任务实际投递到的会话（规则同官方界面）：每次新建会话的任务指向最近一次
 * 投递生成的会话；其余目标自带确定的会话 id。
 */
function targetSessionId(entry: ScheduleCatalogEntry): string | undefined {
  return entry.target.kind === "new"
    ? entry.lastDelivery?.targetSessionId
    : entry.target.sessionId;
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
  const [confirmClearEnded, setConfirmClearEnded] = useState(false);
  const [clearingEnded, setClearingEnded] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const clearEnded = async () => {
    setClearingEnded(true);
    setClearError(null);
    try {
      await tasks.deleteInactive();
      setConfirmClearEnded(false);
      setSelectedId(null);
    } catch (err) {
      setConfirmClearEnded(false);
      setClearError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingEnded(false);
    }
  };

  const sorted = useMemo(() => {
    const rank = { active: 0, paused: 1, ended: 2 } as const;
    return tasks.entries.slice().sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.scheduledAt.localeCompare(b.scheduledAt);
    });
  }, [tasks.entries]);

  /** 已结束任务数：决定「清除全部已结束任务」是否可点。 */
  const endedCount = useMemo(
    () => tasks.entries.filter((entry) => entry.status === "ended").length,
    [tasks.entries],
  );

  // Esc 退出任务视图，主内容区切回会话
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  const sessionName = (entry: ScheduleCatalogEntry): string => {
    const sessionId = targetSessionId(entry);
    if (!sessionId) return t("schedule.task.sessionAfterFirstRun");
    const summary = sessions?.find((s) => s.sessionId === sessionId);
    return summary
      ? sessionTitle(summary, t("sidebar.untitled"))
      : t("schedule.task.sourceSession");
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
        {/* 批量清理失败的独立提示：与刷新错误分开，避免误引向重试刷新 */}
        {clearError && (
          <div className="native-schedule-refresh-error" role="alert">
            <span className="native-schedule-refresh-error-text">{clearError}</span>
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
          <>
            {endedCount > 0 && (
              <div className="native-schedule-list-actions">
                <button
                  type="button"
                  className="native-schedule-clear-ended"
                  disabled={clearingEnded}
                  onClick={() => setConfirmClearEnded(true)}
                >
                  {t("schedule.clear.action")}
                </button>
              </div>
            )}
            <div className="native-schedule-list">
              {sorted.map((entry) => {
                const sessionId = targetSessionId(entry);
                const sessionLabel = sessionName(entry);
                return (
                  <Fragment key={entry.id}>
                    <ScheduleTaskRow
                      entry={entry}
                      expanded={entry.id === selectedId}
                      sessionLabel={sessionLabel}
                      frequency={frequencyLabel(entry, t)}
                      onToggle={() =>
                        setSelectedId((prev) => (prev === entry.id ? null : entry.id))
                      }
                      onOpenSession={
                        sessionId ? () => onOpenSession(sessionId) : undefined
                      }
                    />
                    {/* 详情紧跟所属行展开：列表超出一屏时编辑区不会落在视野外 */}
                    {entry.id === selectedId && (
                      <ScheduleTaskDetail
                        entry={entry}
                        tasks={tasks}
                        sessionLabel={sessionLabel}
                        onOpenSession={
                          sessionId ? () => onOpenSession(sessionId) : undefined
                        }
                        onDeleted={() => setSelectedId(null)}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>
      {confirmClearEnded && (
        <ConfirmDialog
          title={t("schedule.clear.title", { count: endedCount })}
          description={t("schedule.clear.description")}
          confirmLabel={
            clearingEnded ? t("schedule.clear.pending") : t("schedule.clear.confirm")
          }
          confirmDisabled={clearingEnded}
          cancelLabel={t("schedule.task.cancel")}
          closeLabel={t("schedule.clear.close")}
          onConfirm={() => void clearEnded()}
          onCancel={() => setConfirmClearEnded(false)}
        />
      )}
    </div>
  );
}

/** 轻量确认弹窗：批量删除不可撤销，需一次明确确认。 */
function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="native-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="native-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={closeLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="native-dialog-title">{title}</div>
        <p className="native-dialog-desc">{description}</p>
        <div className="native-dialog-actions">
          <button type="button" className="native-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="native-btn native-btn-danger"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
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
  /** 无确定会话（每次新建会话且尚未运行）时不提供跳转。 */
  onOpenSession?: () => void;
}) {
  const t = useT();
  const ended = entry.status === "ended";
  return (
    <button
      type="button"
      className={`native-schedule-row${expanded ? " expanded" : ""}${ended ? " ended" : ""}`}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <div className="native-schedule-row-main">
        <span className="native-schedule-row-title">{entry.title}</span>
        <span className="native-schedule-row-freq">{frequency}</span>
      </div>
      <div className="native-schedule-row-meta">
        <span
          className={`native-schedule-row-status${ended ? " ended" : ""}`}
        >
          {t(`schedule.task.status.${entry.status}`)}
        </span>
        <span className="native-schedule-row-next">
          {ended
            ? t("schedule.task.status.ended")
            : `${t("schedule.task.nextRun")} ${formatDateTime(entry.scheduledAt)}`}
        </span>
        <span
          className={`native-schedule-row-session${onOpenSession ? "" : " pending"}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenSession?.();
          }}
          title={onOpenSession ? t("schedule.task.openSession") : undefined}
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
  /** 无确定会话（每次新建会话且尚未运行）时不提供跳转。 */
  onOpenSession?: () => void;
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
  /** compare-and-set 基线：编辑开始时读到的版本号，保存成功后以引擎返回的
   * 落库记录推进。不能等目录刷新再推进：刷新可能失败或混入外部改动。 */
  const [baseline, setBaseline] = useState<ScheduleCatalogEntry>(entry);
  const [externalChange, setExternalChange] = useState(false);
  /** 已结束任务不可编辑、暂停或恢复（规则同官方界面）。 */
  const ended = entry.status === "ended";

  // 详情打开期间目录项变化：版本号不同即为外部改动，只提示，基线保持原值
  //（保存时与引擎比较必然冲突，由用户重开详情重新加载）。
  useEffect(() => {
    if (entry.updatedAt !== baseline.updatedAt) {
      setExternalChange(true);
    }
    // baseline 有意不入依赖：仅响应目录项引用变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const save = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const patch: SchedulePatch = {};
      const nextTitle = title.trim();
      if (!nextTitle) throw new Error(t("schedule.errors.titleRequired"));
      if (nextTitle !== baseline.title) patch.title = nextTitle;
      if (prompt.trim() !== baseline.prompt) patch.prompt = prompt.trim();
      if (timingTouched && timing.kind !== "readonly") {
        const change = buildTimingChange(timing);
        if ("error" in change) throw new Error(t(`schedule.errors.${change.error}`));
        patch.timing = change;
      }
      if (patch.title === undefined && patch.prompt === undefined && patch.timing === undefined) {
        return;
      }
      const submittedTiming = timingRef.current;
      // 以引擎落库记录推进基线：这是本次保存的确凿结果，与目录刷新成败无关
      const committed = await tasks.updateTask(
        baseline.updatedAt ?? null,
        patch,
        entry.id,
      );
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
      // 版本冲突或任务被外部改动：重读目录，让列表回到真实状态
      await tasks.refresh();
      return;
    } finally {
      setSaving(false);
    }
  };

  /**
   * 暂停与恢复共用一个入口，目标状态由当前状态取反（规则同官方界面）。
   *
   * 版本校验用编辑基线而非目录项：详情打开期间目录可能被外部改动刷新，
   * 这会更新 entry.updatedAt 但按设计不更新表单草稿与基线。若拿目录项的
   * 新版本号提交并推进基线，草稿仍是外部改动前的内容，此后保存会把旧值
   * 当作主动编辑，静默覆盖外部修改。用基线版本号提交则外部改动会得到
   * schedule_conflict，保护不被绕过。
   */
  const toggleActive = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const committed = await tasks.setActive(
        entry.id,
        baseline.updatedAt ?? null,
        entry.status !== "active",
      );
      setBaseline(committed);
      setExternalChange(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      await tasks.refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await tasks.deleteTask(entry.id, baseline.updatedAt ?? null);
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
        <span
          className={`native-schedule-detail-session${onOpenSession ? "" : " pending"}`}
          onClick={onOpenSession}
        >
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
          disabled={ended}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="native-schedule-field">
        <span>{t("schedule.task.promptLabel")}</span>
        <textarea
          className="native-settings-input native-schedule-prompt"
          value={prompt}
          rows={3}
          disabled={ended}
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
            {/* 已结束任务不再触发，编辑与恢复都无意义，只保留删除 */}
            {!ended && (
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
                  className="native-btn"
                  disabled={saving}
                  onClick={() => void toggleActive()}
                >
                  {entry.status === "active"
                    ? t("schedule.task.pause")
                    : t("schedule.task.resume")}
                </button>
              </>
            )}
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
