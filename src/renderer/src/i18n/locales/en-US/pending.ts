import type { pending as zhPending } from "../zh-CN/pending";

export const pending: typeof zhPending = {
  plan: {
    strip: "Plan review",
    discussTitle: "Skip the options and say what you think",
    discuss: "Discuss",
  },
  question: {
    missingQuestion: "Please complete question {n} first",
    needAnswer:
      'Select an option, fill in "Other", or click "Skip this question"',
    progress: "Question {current} of {total}",
    otherMulti: "Other (can be combined with the options above)",
    otherSingle: "Other (type your own)",
    skipped: "Skipped",
    skip: "Skip this question",
    multiHint: "Multiple selections allowed",
    filled: "{count} of {total} completed",
    dismissTitleMulti: "Discard all questions and just type your thoughts",
    dismissTitleSingle: "Skip the preset options and just type your thoughts",
    dismiss: "Just type instead",
    prev: "Previous",
    submitting: "Submitting…",
    next: "Next",
    submit: "Submit",
  },
  status: {
    approval: "Waiting for approval",
    question: "Waiting for answer",
    planReview: "Plan pending review",
  },
  approval: {
    title: "Request approval: {tool}",
    toolFallback: "Tool",
    reject: "Reject",
    allowOnce: "Allow once",
  },
  more: {
    one: "1 more item waiting; continue after this one",
    other: "{count} more items waiting; continue after this one",
  },
};
