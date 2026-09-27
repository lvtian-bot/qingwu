/** composer 域词条：会话输入区（输入框、图片附件、权限/模型选择、@ 文件引用与斜杠命令菜单）。 */
export const composer = {
  /** 输入框占位与发送/停止按钮。 */
  placeholder: "询问任何问题",
  send: "发送",
  stopTitle: "停止 (连按两次 Esc)",
  queueSendTitle: "排队发送（{key}+Enter 插话发送）",
  steerQueueHint: "{key}+Enter 插话发送全部排队消息",

  /** 草稿图片附件与校验提示。 */
  addImage: "添加图片",
  removeImage: "删除图片",
  previewImage: "点击预览大图",
  imageReadFailed: "读取图片失败",
  unsupportedImageType: "不支持的图片格式: {name}。仅支持 PNG、JPEG、WebP、GIF",
  imageTooLarge: "图片 {name} 超过 20MB 上限",
  tooManyImages: "单条消息最多添加 {count} 张图片",

  /** 工具行通用控件。 */
  cancel: "取消",
  selectModel: "选择模型",
  modelCatalogUnavailable: "模型目录不可用",
  reasoningEffort: "推理强度",
  effortDefault: "默认",
  providerEffortTitle: "使用模型服务商默认思考行为",

  /** 完全权限风险确认。 */
  fullAccessWarning:
    "启用完全权限后将减少确认步骤，可直接执行敏感操作、文件修改或外部命令。仅建议在信任后续任务时使用。",
  enableFullAccess: "我已了解风险，启用",
  permissionMode: "权限模式",

  /** 权限预设展示名与描述（未知值由组件原样展示）。 */
  permission: {
    labels: {
      readOnly: "仅可查看",
      workspaceWrite: "工作区内修改",
      fullAccess: "完全权限",
      custom: "自定义",
    },
    descriptions: {
      readOnly: "安全只读模式，禁止任何文件修改和写操作。",
      workspaceWrite: "仅允许在工作区内修改；超出工作区范围的操作需要审批。",
      fullAccess: "完全放开读写与命令限制，不弹审批询问。",
    },
  },

  /** 推理强度档位展示名（未知档位由组件回退目录提供的 name）。 */
  effort: {
    labels: {
      off: "关闭",
      minimal: "最低",
      low: "低",
      medium: "中",
      high: "高",
      max: "最高",
    },
  },

  /** @ 文件引用菜单。 */
  fileMenu: {
    ariaLabel: "文件与文件夹引用",
    header: "文件与文件夹",
    noMatch: "未找到与 \"{query}\" 匹配的文件",
    emptyWorkspace: "工作区内暂无文件",
    drillTitle: "按 Tab 进入该目录",
    move: "移动",
    reference: "引用",
    drill: "下钻",
    close: "关闭",
  },

  /** 斜杠命令与技能菜单。 */
  slash: {
    ariaLabel: "斜杠命令与技能列表",
    noMatch: "无匹配的斜杠命令或技能",
    skillUserOnly: "仅限用户 · {desc}",
    sections: {
      add: "常用",
      commands: "指令",
      skills: "技能",
    },
    labels: {
      goal: "目标",
      plan: "计划",
      feedback: "反馈",
      compact: "压缩",
      permission: "权限",
      model: "模型",
      export: "下载日志",
    },
    descriptions: {
      goal: "设置或查看长期任务目标",
      plan: "进入或退出计划模式",
      feedback: "发送关于当前会话的反馈",
      compact: "压缩以上对话内容",
      permission: "切换权限预设（沙箱模式与审批策略）",
      model: "切换当前会话或默认模型",
      export: "将当前会话内容导出为 ZIP",
    },
    hints: {
      goal: "目标描述",
    },
  },
};
