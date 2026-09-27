export const pending = {
  /** 计划审批卡 */
  plan: {
    strip: "计划审批",
    discussTitle: "不选任何选项，直接说出你的想法",
    discuss: "讨论一下",
  },
  /** 逐题问答卡 */
  question: {
    missingQuestion: "请先完成第 {n} 题",
    needAnswer: "请先选择一个选项、填写「其他」，或点「跳过本题」",
    progress: "第 {current} / {total} 题",
    otherMulti: "其他（可与上面同时选）",
    otherSingle: "其他（自行输入）",
    skipped: "已跳过",
    skip: "跳过本题",
    multiHint: "可多选",
    filled: "已填 {count} / {total}",
    dismissTitleMulti: "放弃当前所有问题，改为直接说出你的想法",
    dismissTitleSingle: "不选择预设选项，改为直接说出你的想法",
    dismiss: "直接打字沟通",
    prev: "上一题",
    submitting: "提交中…",
    next: "下一题",
    submit: "提交",
  },
  /** 侧栏等待状态（PENDING_LABELS 渲染处取词） */
  status: {
    approval: "等待授权",
    question: "等待回答",
    planReview: "计划待审",
  },
  /** 授权审批卡 */
  approval: {
    title: "请求授权：{tool}",
    toolFallback: "工具",
    reject: "拒绝",
    allowOnce: "允许一次",
  },
  /** 待处理项排队提示 */
  more: {
    one: "另有 {count} 项等待处理，处理完这项后继续",
    other: "另有 {count} 项等待处理，处理完这项后继续",
  },
};
