/** 应用级兜底文案：错误边界、RPC 错误、更新窗口。 */
export const app = {
  errorTitle: "界面发生错误",
  errorHint:
    "错误信息已写入应用日志。重新加载通常可以恢复当前窗口；如果问题重复出现，请保留发生时间以便继续排查。",
  reload: "重新加载界面",
  rpc: {
    invalidResult: "{endpoint} 返回非法结果",
    failed: "{endpoint} 失败: {detail}",
  },
  update: {
    devModeTitle: "开发调试模式",
    devModeDesc:
      "当前处于开发调试模式，在线更新仅在正式打包的 Windows 发行版本中生效。您可以前往发布页查看最新版本。",
    openReleases: "访问发布页",
    checkingTitle: "正在检查更新",
    checkingDesc: "正在连接服务器获取最新版本信息…",
    latestTitle: "已是最新版本",
    latestDesc: "青梧 v{version} 目前已是最新版本，无需更新。",
    close: "关闭",
    availableTitle: "发现新版本 v{version}",
    availableDesc: "最新版本 v{latest}，当前版本 v{current}。",
    remindLater: "稍后提醒",
    download: "下载更新",
    downloadingTitle: "正在下载 v{version}",
    readyTitle: "更新已就绪",
    readyDesc: "v{version} 已下载完成，重启应用后完成安装。",
    installLater: "稍后安装",
    restartAndInstall: "重启并安装",
    errorTitle: "更新遇到问题",
    errorDesc: "未能获取版本信息，请稍后重试。",
    retry: "重试",
    footer: "青梧 v{version}",
  },
};
