import { app } from 'electron';
import { resolveLanguage, formatMessage } from '../shared/i18n-core';
import { settings } from './settings';

/**
 * 主进程词条：托盘、系统对话框、通知、更新提示与关于面板。
 * 渲染层界面词条在 renderer i18n 中维护，两处互不共享。
 */

type MainDict = Record<string, string>;

const STRINGS: Record<'zh-CN' | 'en-US', MainDict> = {
  'zh-CN': {
    'tray.open': '打开青梧',
    'tray.checkUpdates': '检查更新...',
    'tray.quit': '退出',
    'dialog.quitTitle': '暂时无法退出青梧',
    'dialog.quitMessage':
      '后台引擎尚未完成清理，可以重试退出。保留应用后，可从托盘选择退出；没有托盘时重新打开青梧可再次尝试退出。',
    'dialog.quitRetry': '重试退出',
    'dialog.quitKeep': '保留应用',
    'dialog.startupFailed': '青梧启动失败',
    'dialog.startupEngine': '无法启动内置引擎服务:\n{detail}\n\n应用即将退出。',
    'dialog.engineExited':
      '后台引擎服务异常退出 (退出码: {code}, 信号: {signal})。请尝试重启应用或重新连接。',
    'dialog.serviceDisconnected': '服务连接已中断',
    'notify.taskFinished': '任务执行完成',
    'update.noRelease': '远程仓库暂无可用的新版本。',
    'update.checksumFailed': '更新包校验失败，请稍后重试或前往发布页手动下载。',
    'update.networkError': '网络连接异常，请检查网络后重试。',
    'update.genericErrorDetail': '更新遇到异常: {detail}',
    'update.genericError': '更新遇到异常，请稍后重试。',
    'update.installFailed': '启动安装失败，请前往发布页手动下载。',
    'about.version': '版本: {version}',
    'about.engine': '内置引擎: {name}',
    'about.unknown': '未知',
  },
  'en-US': {
    'tray.open': 'Open Qingwu',
    'tray.checkUpdates': 'Check for Updates...',
    'tray.quit': 'Quit',
    'dialog.quitTitle': "Can't quit Qingwu right now",
    'dialog.quitMessage':
      "The background engine hasn't finished cleaning up, so you can retry quitting. If you keep the app, you can quit later from the system tray; if the tray is unavailable, reopen Qingwu to try again.",
    'dialog.quitRetry': 'Retry Quit',
    'dialog.quitKeep': 'Keep App',
    'dialog.startupFailed': 'Qingwu failed to start',
    'dialog.startupEngine':
      'Failed to start the built-in engine service:\n{detail}\n\nThe app will now exit.',
    'dialog.engineExited':
      'The background engine service exited unexpectedly (exit code: {code}, signal: {signal}). Try restarting the app or reconnecting.',
    'dialog.serviceDisconnected': 'Service connection lost',
    'notify.taskFinished': 'Task finished',
    'update.noRelease': 'No new version is available in the remote repository yet.',
    'update.checksumFailed':
      'The update package failed verification. Try again later, or download it manually from the releases page.',
    'update.networkError': 'Network connection problem. Check your network and try again.',
    'update.genericErrorDetail': 'Something went wrong while updating: {detail}',
    'update.genericError': 'Something went wrong while updating. Try again later.',
    'update.installFailed':
      'Failed to start the installation. Download it manually from the releases page.',
    'about.version': 'Version: {version}',
    'about.engine': 'Built-in engine: {name}',
    'about.unknown': 'Unknown',
  },
};

/** 当前界面语言：读应用设置，auto 时按系统 locale 解析（zh 开头为中文）。 */
export function resolveAppLanguage(): 'zh-CN' | 'en-US' {
  return resolveLanguage(settings.get('uiLanguage'), app.getLocale());
}

/** 主进程取词：缺失时回退中文，再回退 key 本身。 */
export function tr(key: string, params?: Record<string, string | number>): string {
  const lang = resolveAppLanguage();
  const text = STRINGS[lang][key] ?? STRINGS['zh-CN'][key] ?? key;
  return formatMessage(text, params);
}
