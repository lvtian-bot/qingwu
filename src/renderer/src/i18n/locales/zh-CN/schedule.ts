export const schedule = {
  /** 定时任务页（侧栏「新会话」下方入口） */
  page: {
    ariaLabel: "定时任务页面",
    title: "定时任务",
    note: "任务在青梧运行期间生效，关闭应用后暂停；结果投递到所属会话。",
  },
  /** 列表加载与错误态 */
  list: {
    loading: "正在加载定时任务…",
    retry: "重试",
  },
  /** 空态与创建引导（dsh 无界面创建接口，任务由 AI 在会话内创建） */
  empty: {
    title: "暂无定时任务",
    desc: "在会话里告诉 AI 你的周期性安排，任务创建后会显示在这里，可在此编辑或删除。",
    createInChat: "去会话中创建",
    examplePrompt:
      "帮我创建一个定时任务：每个工作日 9 点汇总当前项目的代码变更和待跟进事项。",
  },
  /** 任务行与详情字段 */
  task: {
    active: "进行中",
    ended: "已结束",
    nextRun: "下次运行",
    sourceSession: "所属会话",
    openSession: "打开所属会话",
    titleLabel: "标题",
    promptLabel: "指令",
    timingLabel: "执行时间",
    timingReadonly: "此类任务暂不支持在此修改时间",
    minutesUnit: "分钟",
    save: "保存",
    saving: "保存中…",
    delete: "删除",
    confirmDelete: "删除",
    cancel: "取消",
    deleteConfirm:
      "任务将停止触发，并连同运行记录一并删除；原会话及其消息仍保留。",
  },
  /** 运行历史（投递记录） */
  history: {
    show: "运行历史",
    hide: "收起历史",
    loading: "正在加载…",
    empty: "暂无运行记录",
    plannedAt: "计划 {time}",
  },
  /** 频率摘要 */
  frequency: {
    once: "单次",
    afterOnce: "{count} 分钟后",
    everyMinutes: "每 {count} 分钟",
    everyHours: "每 {count} 小时",
    daily: "每天 {time}",
    weekly: "每周{days} {time}",
    cron: "Cron {expression}",
  },
  /** 星期标签（ISO 周一=1 … 周日=7） */
  weekday: {
    1: "一",
    2: "二",
    3: "三",
    4: "四",
    5: "五",
    6: "六",
    7: "日",
  },
  /** 编辑校验与操作失败提示 */
  errors: {
    titleRequired: "标题不能为空",
    "at-required": "请选择日期和时间",
    "at-invalid": "日期时间无效",
    "every-invalid": "间隔分钟数无效",
    "time-invalid": "时间格式无效",
    "weekdays-required": "请至少选择一个星期",
  },
};
