export const sidebar = {
  /** 侧栏顶部品牌名 */
  brand: "青梧",
  /** 侧栏搜索：开关按钮提示与输入框占位 */
  search: {
    title: "搜索会话",
    placeholder: "搜索会话",
  },
  /** 新会话按钮 */
  newChat: "新会话",
  /** 侧栏分区标题、添加入口与空态 */
  sections: {
    pinned: "置顶",
    projects: "项目",
    sessions: "会话",
    addProject: "添加项目",
    noProjects: "暂无项目",
  },
  /** 项目内会话列表的展开/收起按钮 */
  group: {
    expand: "展开显示",
    collapse: "收起",
  },
  /** 侧栏底部设置入口 */
  settings: "设置",
  /** 侧栏宽度调节手柄提示 */
  resizeTitle: "拖动调节宽度，双击复位",
  /** 无标题会话的兜底名称（sidebar-data sessionTitle 回退） */
  untitled: "未命名",
  /** 工作区行（SidebarRows WorkspaceRow） */
  workspace: {
    renameAria: "工作区名称",
    pin: "置顶项目",
    unpin: "取消置顶项目",
    menuTitle: "工作区操作",
    menuAria: "工作区“{name}”的操作",
    newChatAria: "在“{name}”中新建会话",
    moveUp: "上移项目",
    moveDown: "下移项目",
    openTerminal: "在终端中打开",
    openFileManager: "在文件管理器中打开",
    rename: "重命名工作区",
    delete: "删除工作区",
    deleteConfirm:
      "将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。",
    cancel: "取消",
    confirmDelete: "删除",
  },
  /** 会话行（SidebarRows SessionRow） */
  session: {
    renameAria: "会话名称",
    menuTitle: "会话操作",
    menuAria: "会话“{name}”的操作",
    pin: "置顶会话",
    unpin: "取消置顶",
    rename: "重命名",
    archive: "归档会话",
  },
  /** 会话行状态标记（SessionStatusMark；等待态提示见 pending 域） */
  status: {
    running: "任务进行中",
    unread: "任务已完成，未查看",
  },
  /** 引导页工作区 chip（WorkspaceChip） */
  chip: {
    title: "选择工作区",
    empty: "暂无工作区",
    add: "添加工作区…",
    noWorkspace: "无工作区",
  },
  /** 已归档会话页（ArchivedSessionsTab） */
  archived: {
    title: "已归档会话",
    subtitle: "恢复或管理已归档的会话。",
    searchPlaceholder: "搜索已归档会话（按标题或项目）...",
    clearSearchTitle: "清空搜索",
    countAll: {
      one: "共 {count} 个已归档会话",
      other: "共 {count} 个已归档会话",
    },
    countFiltered: {
      one: "匹配 {matched} / 共 {count} 个会话",
      other: "匹配 {matched} / 共 {count} 个会话",
    },
    emptyTitle: "暂无已归档会话",
    emptyDesc:
      "在侧边栏会话菜单中选择「归档会话」，即可将暂不使用的会话收纳至此处，主界面更整齐清爽。",
    noMatchTitle: "未找到匹配的已归档会话",
    noMatchDesc: "没有会话匹配关键字 “{query}”，请尝试更换搜索词。",
    clearQuery: "清空搜索词",
    projectTagTitle: "所属项目: {name}",
    restoreOpenTitle: "恢复此会话并立即打开",
    restoreOpen: "恢复并打开",
    unarchiveTitle: "取消归档，放回原项目或会话列表",
    unarchive: "取消归档",
    restoring: "正在恢复…",
    unarchiveFailed: "取消归档失败: {message}",
    untitledProject: "未命名项目",
    untitledSession: "未命名会话",
    ungrouped: "未分组",
  },
  /** 会话操作错误提示（useSessionActions） */
  errors: {
    forkUnavailable: "当前会话不支持分叉",
  },
};
