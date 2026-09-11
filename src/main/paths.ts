import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * userData 重定向到 ASCII 目录（%APPDATA%\qingwu）。
 *
 * Electron 默认取 productName「青梧」当 userData 目录名，缓存与配置落在
 * 非 ASCII 路径；Chromium 与 Node 自身可正常工作，但未来任何把该路径传给
 * 引擎子进程或第三方工具的场景都可能在 ANSI 编码工具链上乱码，故统一改用
 * ASCII 目录。本模块必须在其他模块求值前导入（index.ts 首行）。
 */

const MIGRATE_FILES = ['settings.json', 'window-state.json'];

try {
  const appData = app.getPath('appData');
  const targetDir = path.join(appData, 'qingwu');
  const legacyDir = app.getPath('userData');

  if (path.resolve(targetDir) !== path.resolve(legacyDir) && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    // 只迁移自有配置；Chromium 缓存体积大且可重建，留在旧目录不再使用
    for (const name of MIGRATE_FILES) {
      const from = path.join(legacyDir, name);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(targetDir, name));
      }
    }
    console.log(`[Paths] userData 已迁移: ${legacyDir} -> ${targetDir}`);
  }

  app.setPath('userData', targetDir);
} catch (err) {
  console.error('[Paths] userData 重定向失败，沿用默认目录:', err);
}
