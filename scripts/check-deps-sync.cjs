'use strict';

// 依赖一致性门禁：拦截「升级只改声明文件、本地未重新安装」的过期依赖树。
//
// 背景：升级依赖的提交只更新 package.json / package-lock.json，本地
// node_modules 不会自动跟进；此后在旧依赖上开发与验证，读到的引擎行为、
// 清单输出都是旧版的，曾造成过统计误判，且该情况随每次升级反复出现。
// 正式安装包由 CI 按 lock 全新安装不受影响，本门禁只管本地开发环境。
//
// 核对口径（直接依赖的三方一致）：
// 1. package.json 的依赖声明与 lock 根节点复刻的声明，键集与版本必须双向
//    一致——新增、删除、改版本后未重新安装，三个方向都会失配；
// 2. 声明的每个依赖在 node_modules 的实际版本必须与 lock 记录一致，包缺失
//    或包内 package.json 损坏同样视为不同步；
// 3. 范围只限直接依赖：lock 顶层的其余条目是 npm 自管的传递依赖（实测
//    412/466），对它们做键集比对会全量误报；optionalDependencies 同理
//    不纳入（本项目未使用）。
// 任一处对不上即失败并提示先安装，让问题在开工第一秒被拦下。

const fs = require('node:fs');
const path = require('node:path');

/**
 * 比对一个项目目录的依赖一致性。
 *
 * @param {string} dir 含 package.json、package-lock.json 与 node_modules 的目录。
 * @returns {{ mismatches: Array<{ name: string, kind: 'declared'|'version', declared?: string|undefined,
 *            lockDecl?: string|undefined, lock?: string|null, installed?: string|null }>,
 *            missingLock: boolean }}
 *   mismatches 按核对层分类：declared 为声明与 lock 快照的键集/版本失配
 *   （declared 或 lockDecl 为 undefined 表示单侧缺失），version 为实际安装
 *   与 lock 记录失配（installed 为 null 表示未安装）；missingLock 表示缺
 *   lock 文件。
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

  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const lockDeclared = { ...lockRoot.dependencies, ...lockRoot.devDependencies };
  const mismatches = [];

  // 第一层：声明键集双向比对（新增/删除/改版本未重装都在这里暴露）
  for (const name of new Set([...Object.keys(declared), ...Object.keys(lockDeclared)])) {
    if (declared[name] !== lockDeclared[name]) {
      mismatches.push({
        name,
        kind: 'declared',
        declared: declared[name],
        lockDecl: lockDeclared[name],
      });
    }
  }

  // 第二层：声明仍在的依赖，实际安装版本必须与 lock 记录一致。
  // 声明已失配的包跳过——lock 快照不同步时版本比对只会重复报同一件事。
  // lock 无记录或本地未装任一为空即失配：声明的依赖必须既被 lock 记录、
  // 又被真正安装，两个空值不能互相抵消成「一致」（lock 被部分编辑或
  // 合并冲突后的残留就在这里暴露）。
  for (const name of Object.keys(declared)) {
    if (declared[name] !== lockDeclared[name]) continue;
    const lockVersion = lock.packages?.[`node_modules/${name}`]?.version ?? null;
    const installedPath = path.join(dir, 'node_modules', name, 'package.json');
    let installed = null;
    if (fs.existsSync(installedPath)) {
      try {
        installed = readJson(installedPath).version ?? null;
      } catch {
        installed = 'package.json 损坏';
      }
    }
    if (lockVersion === null || installed === null || installed !== lockVersion) {
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

  console.error('[deps-sync] 本地依赖不同步，检查中止（新增、删除、升级依赖后未重新安装的典型症状）：');
  for (const m of mismatches) {
    if (m.kind === 'declared') {
      const declaredText = m.declared ?? '未声明';
      const lockDeclText = m.lockDecl ?? '未记录';
      console.error(`  ${m.name}: 声明 ${declaredText} / lock 快照 ${lockDeclText}`);
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
