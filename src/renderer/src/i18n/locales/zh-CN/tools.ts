/** 工具调用卡片与任务清单文案：工具卡片、状态、diff、任务面板、交付卡片。 */
export const tools = {
  status: {
    running: "运行中",
    failed: "失败",
    done: "完成",
  },
  cards: {
    runCommand: "执行命令",
    read: "读取",
    readImage: "读取图片",
    search: "搜索",
    match: "匹配",
    edit: "编辑",
    write: "写入",
    deliverable: "交付成果",
    webSearch: "网页搜索",
    webFetch: "网页获取",
    updateTodo: "更新任务清单",
    readRange: {
      fromLine: "从第 {offset} 行",
      starting: "起",
      takeLines: "取 {limit} 行",
    },
  },
  diff: {
    moreLines: {
      one: "… 其余 {count} 行未显示",
      other: "… 其余 {count} 行未显示",
    },
  },
  todo: {
    title: "任务",
    items: {
      one: "{count} 项",
      other: "{count} 项",
    },
    done: "{count} 完成",
    inProgress: "{count} 进行中",
    progress: {
      done: "{count} 已完成",
      active: "{count} 进行中",
      pending: "{count} 待处理",
    },
  },
  deliverables: {
    collapse: "收起交付清单",
    expand: {
      one: "展开全部交付（{count} 项）",
      other: "展开全部交付（{count} 项）",
    },
    open: "打开",
    opened: "已打开",
    reveal: "定位",
    revealed: "已定位",
    openTooltip: "用系统默认程序打开",
    revealTooltip: "在资源管理器中定位",
  },
};
