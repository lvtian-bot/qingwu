/** 自绘菜单文案：标题栏菜单名与菜单项（shared/menu-data 以 key 引用）。 */
export const menu = {
  appMenu: "应用菜单",
  file: {
    name: "文件",
    reload: "重新加载",
    reloadIgnoringCache: "强制重新加载",
    openTerminal: "在终端中打开工作区",
    openFolder: "在文件管理器中打开工作区",
    quit: "退出",
  },
  edit: {
    name: "编辑",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    delete: "删除",
    selectAll: "全选",
    settings: "设置",
  },
  view: {
    name: "视图",
    zoomIn: "放大",
    zoomOut: "缩小",
    resetZoom: "重置缩放",
    toggleFullScreen: "切换全屏",
    toggleDevTools: "开发者工具",
  },
  help: {
    name: "帮助",
    checkForUpdates: "检查更新",
    openGitHub: "GitHub 仓库",
    about: "关于 青梧",
  },
  sidebar: {
    show: "打开侧边栏",
    hide: "收起侧边栏",
  },
};
