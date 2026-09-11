import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from './config';

/** 从内置引擎包读取真实版本号，避免手写字段随依赖升级漂移。 */
function resolveDshVersion(): string {
  const relativePath = path.join('node_modules', '@deepseek-ai', 'dsh', 'package.json');
  const candidates = [
    path.join(app.getAppPath(), relativePath),
    path.join(process.resourcesPath, 'app.asar.unpacked', relativePath),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch (err) {
      console.error('[About] 读取引擎版本失败:', err);
    }
  }
  return '未知';
}

export function setupAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: CONFIG.appName,
    applicationVersion: '版本: ' + app.getVersion(),
    credits: [
      '内置引擎: @deepseek-ai/dsh ' + resolveDshVersion(),
      'Electron: ' + process.versions.electron,
      'Chromium: ' + process.versions.chrome,
      'Node.js: ' + process.versions.node,
    ].join('\n'),
  });
}
