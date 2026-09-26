import { useState } from "react";
import { Markdown } from "./markdown";
import type {
  ApprovalRequestPayload,
  SessionSummary,
  UserQuestionAnswer,
  UserQuestionsRequestPayload,
} from "./protocol";

/** 一道题的暂存答案（skipped 表示用户显式跳过该题，提交空 selected）。 */
interface QuestionDraft {
  selected: string[];
  custom: string;
  skipped?: boolean;
}

/**
 * 识别 plan-review 意图，选举条件与官方同宽：单题、声明意图、detail 存在、
 * approve 指向现有选项 label。不满足时留在通用表单上（意图只改布局，不改可达答案）。
 */
export function planReviewOf(
  questions: NonNullable<UserQuestionsRequestPayload["questions"]>,
): { item: (typeof questions)[number]; approve: string } | null {
  if (questions.length !== 1) return null;
  const item = questions[0];
  const approve =
    item.intent?.kind === "plan-review" ? item.intent.approve : undefined;
  if (!approve || !item.detail) return null;
  if (!(item.options ?? []).some((option) => option.label === approve))
    return null;
  return { item, approve };
}

/**
 * 提问卡片：一次只显示一道题（对齐官方 QuestionComposer）。
 *
 * 引擎一次最多带 4 道题，早先「一屏纵向铺开所有题」的写法会把输入区以上整块占满，
 * 题目越多越难看清；官方口径是一题一屏 + 上一题/下一题 + 题号进度，最后一题才提交。
 * 单选点选即翻到下一题（官方同款），多选与自由文本停在原题，随时可翻回去改。
 * plan-review 意图仍走「计划审批」布局：计划用 markdown 滚动展示，决定按钮直接提交。
 */
export function QuestionCard({
  request,
  onSubmit,
  onDismiss,
}: {
  request: PendingQuestion;
  onSubmit: (answers: UserQuestionAnswer[]) => Promise<boolean>;
  onDismiss: () => Promise<boolean>;
}) {
  const questions = request.questions ?? [];
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() =>
    questions.map(() => ({ selected: [], custom: "" })),
  );
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const plan = planReviewOf(questions);

  if (questions.length === 0) return null;

  const total = questions.length;
  const at = Math.min(index, total - 1);
  const question = questions[at];
  const multi = question.multiSelect === true;
  const emptyDraft = (): QuestionDraft => ({ selected: [], custom: "" });
  const draftAt = (values: QuestionDraft[], item: number): QuestionDraft =>
    values[item] ?? emptyDraft();
  const draft = draftAt(drafts, at);

  /** 已作答：选中了选项或写了「其他」（跳过是另一条出口，不算作答）。 */
  const answered = (item: QuestionDraft) =>
    item.selected.length > 0 || item.custom.trim() !== "";
  const completed = (item: QuestionDraft) =>
    item.skipped === true || answered(item);
  const completedCount = questions.filter((_, item) =>
    completed(draftAt(drafts, item)),
  ).length;

  /** 整组答案：跳过题回空 selected，单选填了「其他」就以自由文本为准。 */
  const buildAnswers = (values: QuestionDraft[]): UserQuestionAnswer[] =>
    questions.map((q, item) => {
      const value = draftAt(values, item);
      const custom = value.custom.trim();
      return {
        id: q.id,
        selected:
          value.skipped || (custom && q.multiSelect !== true)
            ? []
            : value.selected,
        ...(custom ? { custom } : {}),
      };
    });

  const dismiss = async () => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await onDismiss();
    if (!ok) setSubmitting(false);
  };

  /** 提交整组答案：仍有未作答且未跳过的题时跳到那一题并提示（官方口径）。 */
  const submit = async (values: QuestionDraft[]) => {
    if (submitting) return;
    const missing = questions.findIndex(
      (_, item) => !completed(draftAt(values, item)),
    );
    if (missing >= 0) {
      setIndex(missing);
      setError(`请先完成第 ${missing + 1} 题`);
      return;
    }
    setSubmitting(true);
    const ok = await onSubmit(buildAnswers(values));
    if (!ok) setSubmitting(false);
  };

  /** 改写当前题的暂存答案；nextIndex 用于单选题「选中即翻页」。 */
  const updateDraft = (
    update: (current: QuestionDraft) => QuestionDraft,
    nextIndex = at,
  ) => {
    setDrafts((prev) =>
      questions.map((_, item) =>
        item === at ? update(draftAt(prev, item)) : draftAt(prev, item),
      ),
    );
    setIndex(nextIndex);
    setError(null);
  };

  const choose = (label: string) => {
    updateDraft(
      (item) =>
        multi
          ? {
              ...item,
              selected: item.selected.includes(label)
                ? item.selected.filter((entry) => entry !== label)
                : [...item.selected, label],
              skipped: false,
            }
          : // 单选题：选中选项与自定义答案互斥
            { selected: [label], custom: "", skipped: false },
      // 单选点选即翻到下一题，最后一题留在原地等提交
      !multi && at < total - 1 ? at + 1 : at,
    );
  };

  const setCustom = (value: string) => {
    updateDraft((item) => ({
      ...item,
      custom: value,
      selected: multi ? item.selected : [],
      skipped: false,
    }));
  };

  /** 跳过当前题：该题回空 selected；已到最后一题则整组提交。 */
  const skipQuestion = () => {
    const next = questions.map((_, item) =>
      item === at
        ? { selected: [], custom: "", skipped: true }
        : draftAt(drafts, item),
    );
    setDrafts(next);
    setError(null);
    if (at < total - 1) {
      setIndex(at + 1);
      return;
    }
    void submit(next);
  };

  /** 下一题：当前题须已作答（跳过是显式出口）；最后一题直接提交。 */
  const continueFlow = () => {
    if (!answered(draft)) {
      setError("请先选择一个选项、填写「其他」，或点「跳过本题」");
      return;
    }
    if (at < total - 1) {
      setIndex(at + 1);
      setError(null);
      return;
    }
    void submit(drafts);
  };

  // plan-review：计划作为可滚动 markdown，决定按钮直接提交（官方口径：其余选项即拒绝）
  if (plan) {
    const others = (plan.item.options ?? []).filter(
      (option) => option.label !== plan.approve,
    );
    /** 计划审批不走逐题暂存，按钮即整组答案（单题请求）。 */
    const decide = async (label: string) => {
      if (submitting) return;
      setSubmitting(true);
      const ok = await onSubmit([{ id: plan.item.id, selected: [label] }]);
      if (!ok) setSubmitting(false);
    };
    return (
      <div className="native-card question">
        <div className="native-card-strip">计划审批</div>
        {plan.item.header && (
          <div className="native-question-header">{plan.item.header}</div>
        )}
        <div className="native-question-title">{plan.item.question}</div>
        <div className="native-plan">
          <Markdown text={plan.item.detail ?? ""} />
        </div>
        <div className="native-card-actions">
          <span className="native-question-spacer" />
          <button
            type="button"
            className="native-question-dismiss"
            disabled={submitting}
            title="不选任何选项，直接说出你的想法"
            onClick={() => void dismiss()}
          >
            讨论一下
          </button>
          {others.map((option) => (
            <button
              key={option.label}
              type="button"
              disabled={submitting}
              title={option.description}
              onClick={() => void decide(option.label)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="primary"
            disabled={submitting}
            onClick={() => void decide(plan.approve)}
          >
            {plan.approve}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="native-card question">
      <div className="native-question" key={question.id}>
        <div className="native-question-head">
          {question.header && (
            <div className="native-question-header">{question.header}</div>
          )}
          {total > 1 && (
            <div className="native-question-progress">
              第 {at + 1} / {total} 题
            </div>
          )}
        </div>
        <div className="native-question-title">{question.question}</div>
        {question.detail && (
          <div className="native-question-detail">{question.detail}</div>
        )}
        {(question.options ?? []).length > 0 && (
          <div className="native-options" role={multi ? "group" : "radiogroup"}>
            {(question.options ?? []).map((option) => {
              const active = draft.selected.includes(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`native-option${active ? " selected" : ""}`}
                  aria-pressed={active}
                  disabled={submitting}
                  onClick={() => choose(option.label)}
                >
                  <span
                    className={`native-option-mark${multi ? " multi" : ""}`}
                  >
                    {active ? "✓" : ""}
                  </span>
                  <span className="native-option-body">
                    <span className="native-option-label">{option.label}</span>
                    {option.description && (
                      <span className="native-option-desc">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <input
          className="native-question-custom"
          value={draft.custom}
          disabled={submitting}
          placeholder={multi ? "其他（可与上面同时选）" : "其他（自行输入）"}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            continueFlow();
          }}
        />
        <div className="native-question-footnote">
          <button
            type="button"
            className="native-question-skip"
            disabled={submitting}
            onClick={skipQuestion}
          >
            {draft.skipped ? "已跳过" : "跳过本题"}
          </button>
          {multi && <span className="native-question-hint">可多选</span>}
        </div>
      </div>
      <div className="native-card-actions native-question-submit">
        <div className="native-question-status">
          {error ? (
            <span className="native-question-error">{error}</span>
          ) : total > 1 ? (
            <span className="native-question-hint">
              已填 {completedCount} / {total}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="native-question-dismiss"
          disabled={submitting}
          title={
            total > 1
              ? "放弃当前所有问题，改为直接说出你的想法"
              : "不选择预设选项，改为直接说出你的想法"
          }
          onClick={() => void dismiss()}
        >
          直接打字沟通
        </button>
        {total > 1 && (
          <button
            type="button"
            disabled={submitting || at === 0}
            onClick={() => {
              setIndex(at - 1);
              setError(null);
            }}
          >
            上一题
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={submitting}
          onClick={continueFlow}
        >
          {submitting ? "提交中…" : at < total - 1 ? "下一题" : "提交"}
        </button>
      </div>
    </div>
  );
}

/** 待处理项的呈现类别（决定同一会话内的优先级与侧栏提示文案）。 */
export type PendingKind = "approval" | "question" | "plan-review";

/** 待决策审批（$events 瀑布）。 */
export interface PendingApproval extends ApprovalRequestPayload {
  eventId: string;
  clientId: string;
  /**
   * 归属会话 id：瀑布帧的 agentId。引擎里 Agent id 恒等于 Session id，
   * 所以待处理项天然属于发起它的那个会话。
   */
  sessionId: string;
}

/** 待回答问答（$events 瀑布）。 */
export interface PendingQuestion extends UserQuestionsRequestPayload {
  eventId: string;
  clientId: string;
  sessionId: string;
}

/**
 * 归拢后的一条待处理项：类别 + 原载荷 + 归属会话（已解到根会话）。
 * 同一会话内多条等待的优先级顺序与官方一致（计划审批 > 提问 > 授权）。
 */
export type PendingEntry =
  | { kind: "approval"; approval: PendingApproval; owner: string }
  | {
      kind: "question" | "plan-review";
      question: PendingQuestion;
      owner: string;
    };

/** 同一会话里只展示一条待处理项；多条并存时按此优先级取最高的那条。 */
export const PENDING_PRECEDENCE: Record<PendingKind, number> = {
  approval: 0,
  question: 1,
  "plan-review": 2,
};

/** 侧栏会话行的等待提示（对齐官方 status.waitingApproval 等口径）。 */
export const PENDING_LABELS: Record<PendingKind, string> = {
  approval: "等待授权",
  question: "等待回答",
  "plan-review": "计划待审",
};

/**
 * 待处理项的所属会话：子代理会话归到它的根会话，其余会话（含分叉会话）归到自己。
 *
 * 界面不展示子代理会话（见 SessionSidebar 的 visibleSessions），子代理请求审批时若按子会话
 * 归位，那张卡片在界面上就没有任何入口可答，宿主会一直挂着等。分叉会话的摘要同样带
 * parentSessionId（引擎用于溯源），但它自己可见、拥有独立的 Agent，待处理项必须归到
 * 自己，否则会串到源会话。会话不在列表里（已删除、帧缺 agentId）时原样返回，由调用方
 * 决定兜底。
 */
export function ownerSessionOf(
  sessionId: string,
  byId: Map<string, SessionSummary>,
): string {
  let current = sessionId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const entry = byId.get(current);
    // 向父级归并仅限界面不可见的子代理会话；可见会话（含分叉会话）自己收下待处理项。
    if (!entry || entry.origin !== "subagent") break;
    const parent = entry.parentSessionId;
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** 待处理项按归属会话归拢的结果：按会话分组 + 无归属兜底项。 */
export interface PendingGroups {
  pendingBySession: Map<string, PendingEntry[]>;
  /**
   * 归属会话已不在列表里的项（例如会话被删除、帧缺 agentId）——
   * 这类项在界面上没有任何入口可答，兜底显示在当前会话里，至少还能提交或放弃。
   */
  orphanPending: PendingEntry[];
}

/**
 * 待处理项按归属会话归拢：审批/问答只属于发起它的那个会话（子代理项归到根会话），
 * 同一会话内多条并存时按优先级降序排序，展示时只取最高的一条（对齐官方的 composer 位）。
 */
export function groupPendingEntries(
  approvals: PendingApproval[],
  questions: PendingQuestion[],
  sessionById: Map<string, SessionSummary>,
): PendingGroups {
  const bySession = new Map<string, PendingEntry[]>();
  const orphans: PendingEntry[] = [];
  const push = (entry: PendingEntry) => {
    if (!entry.owner || !sessionById.has(entry.owner)) {
      orphans.push(entry);
      return;
    }
    const list = bySession.get(entry.owner);
    if (list) list.push(entry);
    else bySession.set(entry.owner, [entry]);
  };
  for (const approval of approvals) {
    push({
      kind: "approval",
      approval,
      owner: ownerSessionOf(approval.sessionId, sessionById),
    });
  }
  for (const question of questions) {
    push({
      kind: planReviewOf(question.questions ?? [])
        ? "plan-review"
        : "question",
      question,
      owner: ownerSessionOf(question.sessionId, sessionById),
    });
  }
  for (const list of bySession.values()) {
    list.sort(
      (a, b) => PENDING_PRECEDENCE[b.kind] - PENDING_PRECEDENCE[a.kind],
    );
  }
  return { pendingBySession: bySession, orphanPending: orphans };
}

/** 决策请求统一占用输入框位置，处理完成后再显示下一项。 */
export function PendingInteraction({
  entry,
  morePending,
  onApproval,
  onQuestionAnswer,
  onQuestionDismiss,
}: {
  entry: PendingEntry;
  morePending: number;
  onApproval: (
    approval: PendingApproval,
    outcome: "allowed-once" | "rejected",
  ) => Promise<void>;
  onQuestionAnswer: (
    question: PendingQuestion,
    answers: UserQuestionAnswer[],
  ) => Promise<boolean>;
  onQuestionDismiss: (question: PendingQuestion) => Promise<boolean>;
}) {
  return (
    <div className="native-interactions">
      {entry.kind === "approval" ? (
        <div className="native-card approval">
          <div className="native-card-title">
            请求授权：{entry.approval.toolName ?? "工具"}
          </div>
          {entry.approval.reason && (
            <div className="native-card-text">{entry.approval.reason}</div>
          )}
          <div className="native-card-actions">
            <button onClick={() => void onApproval(entry.approval, "rejected")}>
              拒绝
            </button>
            <button
              className="primary"
              onClick={() => void onApproval(entry.approval, "allowed-once")}
            >
              允许一次
            </button>
          </div>
        </div>
      ) : (
        <QuestionCard
          key={entry.question.eventId}
          request={entry.question}
          onSubmit={(answers) => onQuestionAnswer(entry.question, answers)}
          onDismiss={() => onQuestionDismiss(entry.question)}
        />
      )}
      {morePending > 0 && (
        <div className="native-pending-more">
          另有 {morePending} 项等待处理，处理完这项后继续
        </div>
      )}
    </div>
  );
}
