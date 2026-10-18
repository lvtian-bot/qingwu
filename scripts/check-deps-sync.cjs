'use strict';

// 依赖一致性门禁：拦截「升级只改声明文件、本地未重新安装」的过期依赖树。
//
// 背景：升级依赖的提交只更新 package.json / package-lock.json，本地
// node_modules 不会自动跟进；此后在旧依赖上开发与验证，读到的引擎行为、
// 清单输出都是旧版的，曾造成过统计误判，且该情况随每次升级反复出现。
// 正式安装包由 CI 按 lock 全新安装不受影响，本门禁只管本地开发环境。
//
// 核对口径：package-lock.json 是上次安装的快照，顶层依赖在 node_modules
// 里的实际版本必须与 lock 记录一致；包缺失同样视为不同步。两处对不上
// 即失败并提示先安装，让问题在开工第一秒被拦下，不依赖人工记性。

const fs = require('node:fs');
const path = require('node:path');

/**
 * 比对一个项目目录的依赖一致性。
 *
 * @param {string} dir 含 package.json、package-lock.json 与 node_modules 的目录。
 * @returns {{ mismatches: Array<{ name: string, lock: string|null, installed: string|null }>,
 *            missingLock: boolean }}
 *   mismatches 为版本对不上或包缺失的顶层依赖清单；missingLock 表示缺 lock 文件。
 */
function collectMismatches(dir) {
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const pkg = readJson(path.join(dir, 'package.json'));
  const lockPath = path.join(dir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return { mismatches: [], missingLock: true };
  }
  const lock = readJson(lockPath);

  const wanted = { ...pkg.dependencies, ...pkg.devDependencies };
  const mismatches = [];
  for (const name of Object.keys(wanted)) {
    const lockVersion = lock.packages?.[`node_modules/${name}`]?.version ?? null;
    const installedPath = path.join(dir, 'node_modules', name, 'package.json');
    let installed = null;
    if (fs.existsSync(installedPath)) {
      installed = readJson(installedPath).version;
    }
    if (installed !== lockVersion) {
      mismatches.push({ name, lock: lockVersion, installed });
    }
  }
  return { mismatches, missingLock: false };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const { mismatches, missingLock } = collectMismatches(root);

  if (missingLock) {
    console.error('[deps-sync] 缺少 package-lock.json，无法核对依赖一致性；请先 npm install');
    process.exitCode = 1;
    return;
  }
  if (mismatches.length === 0) {
    console.log('[deps-sync] 依赖一致性核对通过：node_modules 与 package-lock.json 同步');
    return;
  }

  console.error('[deps-sync] 本地依赖与 lock 文件不同步，检查中止（升级后未重新安装的典型症状）：');
  for (const { name, lock, installed } of mismatches) {
    const installedText = installed ?? '未安装';
    const lockText = lock ?? 'lock 未记录';
    console.error(`  ${name}: lock ${lockText} / 实际 ${installedText}`);
  }
  console.error('请先运行 npm install 同步依赖后再继续。');
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { collectMismatches };
