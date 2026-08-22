import { app } from 'electron';
import { CONFIG } from './config';

export function setupAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: CONFIG.appName,
    applicationVersion: '版本: ' + app.getVersion(),
    credits: [
      '内置引擎: @deepseek-ai/dsh ' + CONFIG.harnessVersion,
      'Electron: ' + process.versions.electron,
      'Chromium: ' + process.versions.chrome,
      'Node.js: ' + process.versions.node,
    ].join('\n'),
  });
}
