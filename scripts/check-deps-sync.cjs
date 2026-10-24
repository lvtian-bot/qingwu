'use strict';

// 依赖一致性门禁：拦截「升级只改声明文件、本地未重新安装」的过期依赖树。
//
// 背景：升级依赖的提交只更新 package.json / package-lock.json，本地
// node_modules 不会自动跟进；此后在旧依赖上开发与验证，读到的引擎行为、
// 清单输出都是旧版的，曾造成过统计误判，且该情况随每次升级反复出现。
// 正式安装包由 CI 按 lock 全新安装不受影响，本门禁只管本地开发环境。
//
// 核对口径（直接依赖的三方一致）：
// 1. package.json 与 lock 根节点的依赖声明按「生产依赖区 dependencies、
//    开发依赖区 devDependencies」两区分别双向比对——键集与版本任一不
//    一致即失配；新增、删除、改版本、跨区移动后未重新安装都会暴露
//    （区间归属决定安装包装什么，不能合并成一张名单比对）；
// 2. 两区声明都与快照一致的依赖，其实际安装版本必须与 lock 记录一致；
//    lock 无记录、本地未装、包内 package.json 损坏都视为不同步，两个
//    空值不能互相抵消成「一致」；
// 3. 范围只限直接依赖：lock 顶层的其余条目是 npm 自管的传递依赖（实测
//    412/466），对它们做键集比对会全量误报；optionalDependencies 同理
//    不纳入（本项目未使用）；v1 老格式或损坏的 lock（无 packages 结构）
//    明确报不可用。
// 4. file: 本地目录依赖（@qingwu/dsh-profile）按内容双向核对副本与源
//    目录：npm 在 lock 未变时跳过重拷贝这类依赖，副本内容陈旧（曾因
//    缺少 Exa 插件配置致契约测试失败）只有内容比对能发现。比对以 npm
//    打包语义为准：源侧先剔除 npm 永不打包的 .git、node_modules、
//    .DS_Store，声明 files 白名单时只要求白名单命中项与 npm 恒包含项
//    （package.json、README、LICENSE）进副本——不在打包范围的源文件
//    与运行时无关，不要求进副本，否则重装也无法消除、门禁假死。
//    glob 仅支持 *、**、? 的常见形态；副本未安装由口径 2 覆盖不重复报。
// 任一处对不上即失败并提示先安装，让问题在开工第一秒被拦下。

const fs = require('node:fs');
const path = require('node:path');

// npm 打包本地目录依赖时的永久排除项（文件与目录同名同 exclusion）
const FILE_DEP_PACK_EXCLUDES = new Set(['.git', 'node_modules', '.DS_Store']);

// npm 无论 files 白名单如何都恒包含的文件形态
const FILE_DEP_ALWAYS_INCLUDED = [/^package\.json$/i, /^readme(\..*)?$/i, /^licen[cs]e(\..*)?$/i];

function listFilesRel(root) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (FILE_DEP_PACK_EXCLUDES.has(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        files.push(path.relative(root, path.join(current, entry.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return files.sort();
}

// 极简 glob：** 跨目录、* 段内任意、? 单字符，覆盖 files 白名单常见写法
function matchesFilePattern(rel, pattern) {
  const regex = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((seg) =>
          seg === '**'
            ? '.*'
            : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.'),
        )
        .join('/') +
      '$',
  );
  return regex.test(rel);
}

// 源目录中按 npm 打包语义会进入副本的文件（相对路径）
function sourceFilesToPack(sourceRoot) {
  const all = listFilesRel(sourceRoot);
  let filesField;
  try {
    filesField = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')).files;
  } catch {
    return all; // 源 package.json 读不了时保守按全量比对，内容核对仍能兜底
  }
  if (!Array.isArray(filesField)) return all; // 未声明白名单：除排除项外全打包
  const patterns = filesField.map((p) => String(p).replace(/\\/g, '/'));
  return all.filter((rel) => {
    if (FILE_DEP_ALWAYS_INCLUDED.some((re) => re.test(rel))) return true;
    return patterns.some((p) => matchesFilePattern(rel, p));
  });
}

/**
 * 核对 file: 本地目录依赖的副本内容与源目录一致。
 *
 * @param {string} dir 项目目录。
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} pkg
 *   已解析的 package.json。
 * @returns {Array<{ name: string, kind: 'filedep', detail: string }>}
 *   detail 概述首个失配文件的相对路径与差异形态（内容不同、副本缺失、
 *   副本多出、源目录缺失），最多列 5 条。副本目录不存在时不报，由版本
 *   核对层统一覆盖。
 */
function collectFileDepMismatches(dir, pkg) {
  const mismatches = [];
  const specs = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, spec] of Object.entries(specs)) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
    const sourceRoot = path.resolve(dir, spec.slice('file:'.length));
    const copyRoot = path.join(dir, 'node_modules', name);
    if (!fs.existsSync(copyRoot)) continue;
    if (!fs.existsSync(sourceRoot)) {
      mismatches.push({ name, kind: 'filedep', detail: '源目录缺失' });
      continue;
    }
    const sourceFiles = sourceFilesToPack(sourceRoot);
    const copyFiles = listFilesRel(copyRoot);
    const copySet = new Set(copyFiles);
    const sourceSet = new Set(sourceFiles);
    const details = [];
    for (const rel of sourceFiles) {
      if (!copySet.has(rel)) {
        details.push(`${rel} 副本缺失`);
      } else if (
        !fs.readFileSync(path.join(sourceRoot, rel)).equals(fs.readFileSync(path.join(copyRoot, rel)))
      ) {
        details.push(`${rel} 内容不同`);
      }
    }
    for (const rel of copyFiles) {
      if (!sourceSet.has(rel)) details.push(`${rel} 副本多出`);
    }
    if (details.length > 0) {
      const list = details.slice(0, 5).join('；') + (details.length > 5 ? '；等' : '');
      mismatches.push({ name, kind: 'filedep', detail: list });
    }
  }
  return mismatches;
}

/**
 * 比对一个项目目录的依赖一致性。
 *
 * @param {string} dir 含 package.json、package-lock.json 与 node_modules 的目录。
 * @returns {{ mismatches: Array<{ name: string, kind: 'declared'|'version', section?: string,
 *            declared?: string|undefined, lockDecl?: string|undefined, lock?: string|null,
 *            installed?: string|null }>,
 *            missingLock: boolean, unusableLock: boolean }}
 *   mismatches 按核对层分类：declared 为某依赖区的声明与 lock 快照键集/版本
 *   失配（section 标注所在区，declared 或 lockDecl 为 undefined 表示单侧
 *   缺失），version 为实际安装与 lock 记录失配（installed 为 null 表示未
 *   安装），filedep 为 file: 本地目录依赖的副本内容与源目录失配（detail
 *   概述差异文件）；missingLock 表示缺 lock 文件，unusableLock 表示 lock 无
 *   packages 结构（v1 老格式或损坏）。
 */
function collectMismatches(dir) {
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const pkg = readJson(path.join(dir, 'package.json'));
  const lockPath = path.join(dir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return { mismatches: [], missingLock: true, unusableLock: false };
  }
  const lock = readJson(lockPath);
  // v1 格式或损坏结构的 lock 没有 packages 字段：按区核对无从谈起，
  // 明确报不可用，避免把空结构当成「lock 未声明任何依赖」全量误报
  if (!lock.packages || typeof lock.packages !== 'object') {
    return { mismatches: [], missingLock: false, unusableLock: true };
  }
  const lockRoot = lock.packages[''] ?? {};

  const SECTIONS = ['dependencies', 'devDependencies'];
  const sectionOf = (obj, sec) => obj?.[sec] ?? {};
  const mismatches = [];

  // 第一层：声明与 lock 根快照按区双向比对。不能把两个区合并成一张
  // 名单：依赖在区间移动（版本不变）不重新安装时，合并比对会因键值
  // 相同而放行，而区间归属直接决定安装包装什么（本项目曾以移动到
  // devDependencies 精简安装包），必须分别核对。
  const allKeys = new Set();
  for (const sec of SECTIONS) {
    const declSec = sectionOf(pkg, sec);
    const lockSec = sectionOf(lockRoot, sec);
    for (const name of new Set([...Object.keys(declSec), ...Object.keys(lockSec)])) {
      allKeys.add(name);
      if (declSec[name] !== lockSec[name]) {
        mismatches.push({
          name,
          kind: 'declared',
          section: sec,
          declared: declSec[name],
          lockDecl: lockSec[name],
        });
      }
    }
  }

  // 第二层：声明在所有区都与快照一致的依赖，实际安装版本必须与 lock
  // 记录一致。声明已失配的包跳过——快照不同步时版本比对只会重复报同
  // 一件事。lock 无记录或本地未装任一为空即失配：声明的依赖必须既被
  // lock 记录、又被真正安装，两个空值不能互相抵消成「一致」（lock 被
  // 部分编辑或合并冲突后的残留就在这里暴露）。
  for (const name of allKeys) {
    const sectionsAgree = SECTIONS.every(
      (sec) => sectionOf(pkg, sec)[name] === sectionOf(lockRoot, sec)[name],
    );
    if (!sectionsAgree) continue;
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
  // 第三层：file: 本地目录依赖的副本必须与源目录内容一致。版本核对只看
  // package.json 的 version，副本内容陈旧（源目录改了、lock 未变、npm 跳过
  // 重拷贝）在这一层暴露。
  mismatches.push(...collectFileDepMismatches(dir, pkg));
  return { mismatches, missingLock: false, unusableLock: false };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const { mismatches, missingLock, unusableLock } = collectMismatches(root);

  if (missingLock) {
    console.error('[deps-sync] 缺少 package-lock.json，无法核对依赖一致性；请先 npm install');
    process.exitCode = 1;
    return;
  }
  if (unusableLock) {
    console.error('[deps-sync] package-lock.json 缺少 packages 结构（v1 老格式或损坏）；请先 npm install 重新生成');
    process.exitCode = 1;
    return;
  }
  if (mismatches.length === 0) {
    console.log('[deps-sync] 依赖一致性核对通过：声明、lock 与 node_modules 三方同步');
    return;
  }

  console.error('[deps-sync] 本地依赖不同步，检查中止（新增、删除、升级、移动依赖后未重新安装的典型症状）：');
  for (const m of mismatches) {
    if (m.kind === 'declared') {
      const declaredText = m.declared ?? '未声明';
      const lockDeclText = m.lockDecl ?? '未记录';
      const sectionText = m.section === 'devDependencies' ? '开发依赖区' : '生产依赖区';
      console.error(`  ${m.name}（${sectionText}）: 声明 ${declaredText} / lock 快照 ${lockDeclText}`);
    } else if (m.kind === 'filedep') {
      console.error(
        `  ${m.name}（file: 本地依赖）: 副本与源目录不一致——${m.detail}；请删除 node_modules/${m.name} 后重新 npm install`,
      );
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
