import { app, dialog, shell } from 'electron';
import { CONFIG } from './config.js';

export function setupAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: CONFIG.appName,
    applicationVersion: `v${app.getVersion()}`,
    version: app.getVersion(),
    copyright: 'Copyright © 2026 Qingwu Authors',
    credits: [
      `内置引擎: @deepseek-ai/dsh ${CONFIG.harnessVersion || '0.1.0-rc.7'}`,
      `Electron: v${process.versions.electron}`,
      `Chromium: v${process.versions.chrome}`,
      `Node.js: v${process.versions.node}`,
    ].join('\n'),
  });
}

export async function showAboutDialog(parentWindow, iconPath) {
  const version = app.getVersion();
  const harnessVersion = CONFIG.harnessVersion || '0.1.0-rc.7';

  const detail = [
    `版本: v${version}`,
    `内置引擎: @deepseek-ai/dsh ${harnessVersion}`,
    '',
    `Electron: v${process.versions.electron}`,
    `Chromium: v${process.versions.chrome}`,
    `Node.js: v${process.versions.node}`,
    `系统架构: ${process.platform} (${process.arch})`,
  ].join('\n');

  const result = await dialog.showMessageBox(parentWindow || null, {
    type: 'info',
    title: `关于${CONFIG.appName}`,
    message: `${CONFIG.appName} (Qingwu)`,
    detail,
    icon: iconPath,
    buttons: ['确定', '访问项目主页'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  if (result.response === 1) {
    shell.openExternal(CONFIG.repositoryUrl || 'https://github.com/deepseek-ai/dsh');
  }
}
