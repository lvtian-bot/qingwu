'use strict';

// 依赖一致性门禁：拦截「升级只改声明文件、本地未重新安装」的过期依赖树。
//
// 背景：升级依赖的提交只更新 package.json / package-lock.json，本地
// node_modules 不会自动跟进；此后在旧依赖上开发与验证，读到的引擎行为、
// 清单输出都是旧版的，曾造成过统计误判，且该情况随每次升级反复出现。
// 正式安装包由 CI 按 lock 全新安装不受影响，本门禁只管本地开发环境。
//
// 核对口径（三层一致）：
// 1. package.json 的依赖声明必须与 lock 根节点复刻的声明一致——改了声明
//    未重新安装时，lock 与本地往往同旧，仅比对后两者会误放行；
// 2. 顶层依赖在 node_modules 的实际版本必须与 lock 记录一致；
// 3. 包缺失同样视为不同步。
// 三处任一对不上即失败并提示先安装，让问题在开工第一秒被拦下。

const fs = require('node:fs');
const path = require('node:path');

/**
 * 比对一个项目目录的依赖一致性。
 *
 * @param {string} dir 含 package.json、package-lock.json 与 node_modules 的目录。
 * @returns {{ mismatches: Array<{ name: string, kind: 'declared'|'version', declared?: string,
 *            lockDecl?: string, lock?: string|null, installed?: string|null }>,
 *            missingLock: boolean }}
 *   mismatches 按核对层分类：declared 为声明与 lock 快照不符，version 为
 *   实际版本与 lock 记录不符或包缺失；missingLock 表示缺 lock 文件。
 */
function collectMismatches(dir) {
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const pkg = readJson(path.join(dir, 'package.json'));
  const lockPath = path.join(dir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return { mismatches: [], missingLock: true };
  }
  const lock = readJson(lockPath);
  const lockRoot = lock.packages?.[''] ?? {};

  const wanted = { ...pkg.dependencies, ...pkg.devDependencies };
  const mismatches = [];
  for (const [name, declared] of Object.entries(wanted)) {
    // 第一层：声明必须与 lock 根快照一致（npm install 时复刻，改声明未重装即失配）
    const lockDeclared = { ...lockRoot.dependencies, ...lockRoot.devDependencies }[name];
    if (lockDeclared !== undefined && declared !== lockDeclared) {
      mismatches.push({ name, kind: 'declared', declared, lockDecl: lockDeclared });
    }

    // 第二层：实际安装版本必须与 lock 记录一致
    const lockVersion = lock.packages?.[`node_modules/${name}`]?.version ?? null;
    const installedPath = path.join(dir, 'node_modules', name, 'package.json');
    let installed = null;
    if (fs.existsSync(installedPath)) {
      installed = readJson(installedPath).version;
    }
    if (installed !== lockVersion) {
      mismatches.push({ name, kind: 'version', lock: lockVersion, installed });
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
    console.log('[deps-sync] 依赖一致性核对通过：声明、lock 与 node_modules 三方同步');
    return;
  }

  console.error('[deps-sync] 本地依赖不同步，检查中止（升级或改声明后未重新安装的典型症状）：');
  for (const m of mismatches) {
    if (m.kind === 'declared') {
      console.error(`  ${m.name}: 声明 ${m.declared} / lock 快照 ${m.lockDecl}（package.json 改动未落 lock）`);
    } else {
      const installedText = m.installed ?? '未安装';
      const lockText = m.lock ?? 'lock 未记录';
      console.error(`  ${m.name}: lock ${lockText} / 实际 ${installedText}`);
    }
  }
  console.error('请先运行 npm install 同步依赖后再继续。');
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { collectMismatches };
