/** 右侧工作区面板文案：面板壳、页签条、开始页、文件树与文件预览。 */
export const panel = {
  /** 面板壳：角色标注、宽度拖拽与收起控件。 */
  shell: {
    ariaLabel: "工作区面板",
    resizerTitle: "拖动调节宽度，双击复位",
    collapse: "收起面板",
  },
  fullscreen: {
    enter: "全屏",
    exit: "退出全屏",
  },
  /** 页签条：新建按钮与各页签的标注。 */
  tab: {
    newTab: "新建标签页",
    guide: "新标签页",
    files: "工作区文件",
    closeTitle: "关闭",
    closeNamed: "关闭 {name}",
    closeTarget: "页签",
  },
  /** 开始页入口卡片。 */
  guide: {
    files: {
      title: "工作区文件",
      desc: "浏览会话工作区的文件",
    },
    terminal: {
      title: "新建终端",
      desc: "在会话工作区运行命令",
    },
  },
  /** 工作区文件页：目录树浏览。 */
  files: {
    noSessionNote: "选中会话后即可浏览其工作区文件",
    noCwdNote: "当前会话没有关联的工作目录",
    refreshTitle: "重新读取",
    refreshAria: "重新读取目录",
    treeAria: "工作区文件树",
    emptyFolder: "此文件夹为空",
    truncated: "条目过多，其余已省略",
    loading: "读取中…",
    readFailed: "读取失败",
    error: {
      notFound: "目录不存在",
      outsideWorkspace: "路径超出工作区范围",
      notDirectory: "路径不是目录",
      badRequest: "路径不合法",
    },
  },
  /** 文件预览页：文本、Markdown 与图片。 */
  preview: {
    noSession: "当前没有选中的会话",
    imageFailed: "图片读取失败",
    fileVanished: "文件已不存在或已被删除",
    wrapOffTitle: "切换为不换行",
    wrapOnTitle: "切换为自动换行",
    reloadTitle: "重新载入",
    openExternal: "用系统默认程序打开",
    loadingDoc: "文档加载中…",
    convertingDoc: "正在生成文档预览…",
    pageCount: "共 {count} 页",
    convertFailed: "文档预览生成失败，可尝试使用外部程序打开",
    retry: "重试",
    unsupported: "此文件类型暂不支持在面板内预览",
    loadMore: "加载更多",
    loadingMore: "加载中…",
    codeOverflow: "内容过长，仅显示前 {count} 行",
    emptyFile: "（空文件）",
    error: {
      notFound: "文件不存在",
      notText: "不是文本文件",
      tooLarge: "文件超出可读取的大小上限",
      notRegularFile: "不是普通文件",
      outsideWorkspace: "路径超出工作区范围",
    },
  },
};
