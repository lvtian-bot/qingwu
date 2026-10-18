'use strict';

// 依赖一致性门禁的核对逻辑：声明（生产/开发两区独立）与 lock 快照、
// node_modules 实际版本三方必须一致；增、删、改、跨区移动后未重装、
// 记录缺失、文件损坏、lock 缺失或老格式都要在开工时被识别。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectMismatches } = require('../scripts/check-deps-sync.cjs');

function makeProject({ deps, devDeps, lockRootDeps, lockRootDevDeps, lockEntries, installed, noPackagesLock }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-deps-sync-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: 't', version: '0.0.0', dependencies: deps ?? {}, devDependencies: devDeps ?? {} },
      null,
      2,
    ),
  );
  const packages = noPackagesLock
    ? undefined
    : {
        '': {
          name: 't',
          version: '0.0.0',
          dependencies: lockRootDeps ?? deps ?? {},
          devDependencies: lockRootDevDeps ?? devDeps ?? {},
        },
        ...lockEntries,
      };
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(
      { name: 't', version: '0.0.0', lockfileVersion: 3, ...(packages ? { packages } : {}) },
      null,
      2,
    ),
  );
  for (const [name, version] of Object.entries(installed ?? {})) {
    const pkgDir = path.join(dir, 'node_modules', name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }));
  }
  return dir;
}

test('声明、lock 与实际版本三方一致时通过', () => {
  const dir = makeProject({
    deps: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    lockEntries: { 'node_modules/@deepseek-ai/dsh': { version: '0.2.1-rc.2' } },
    installed: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
  });
  const { mismatches, missingLock, unusableLock } = collectMismatches(dir);
  assert.equal(missingLock, false);
  assert.equal(unusableLock, false);
  assert.deepEqual(mismatches, []);
});

test('改了声明未重新安装时报告声明失配（lock 与本地同旧不能放行）', () => {
  const dir = makeProject({
    deps: { '@deepseek-ai/dsh': '0.2.2' },
    lockRootDeps: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    lockEntries: { 'node_modules/@deepseek-ai/dsh': { version: '0.2.1-rc.2' } },
    installed: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
  });
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    {
      name: '@deepseek-ai/dsh',
      kind: 'declared',
      section: 'dependencies',
      declared: '0.2.2',
      lockDecl: '0.2.1-rc.2',
    },
  ]);
});

test('新增依赖未安装（lock 与本地均无记录）不放行', () => {
  const dir = makeProject({
    deps: { '@deepseek-ai/dsh': '0.2.1-rc.2', ws: '^8.0.0' },
    lockRootDeps: { '@deepseek-ai/dsh': '0.2.1-rc.2' }, // ws 未进 lock 根快照
    lockEntries: { 'node_modules/@deepseek-ai/dsh': { version: '0.2.1-rc.2' } },
    installed: { '@deepseek-ai/dsh': '0.2.1-rc.2' }, // ws 未安装
  });
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    { name: 'ws', kind: 'declared', section: 'dependencies', declared: '^8.0.0', lockDecl: undefined },
  ]);
});

test('删除依赖未重新安装（lock 快照仍留旧声明）不放行', () => {
  const dir = makeProject({
    deps: {}, // package.json 已删空
    lockRootDeps: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    lockEntries: { 'node_modules/@deepseek-ai/dsh': { version: '0.2.1-rc.2' } },
    installed: { '@deepseek-ai/dsh': '0.2.1-rc.2' }, // 旧包仍留在本地
  });
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    {
      name: '@deepseek-ai/dsh',
      kind: 'declared',
      section: 'dependencies',
      declared: undefined,
      lockDecl: '0.2.1-rc.2',
    },
  ]);
});

test('依赖跨区移动（版本不变）未重新安装不放行', () => {
  // 本项目真实操作形态（曾以移动到 devDependencies 精简安装包）：
  // shiki 从 dependencies 挪到 devDependencies，lock 快照两区都还是旧的
  const dir = makeProject({
    devDeps: { shiki: '^4.4.3' }, // 声明已在开发区
    lockRootDeps: { shiki: '^4.4.3' }, // lock 快照还在生产区
    lockRootDevDeps: {}, // lock 快照开发区没有它
    lockEntries: { 'node_modules/shiki': { version: '4.4.3' } },
    installed: { shiki: '4.4.3' },
  });
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    {
      name: 'shiki',
      kind: 'declared',
      section: 'dependencies',
      declared: undefined,
      lockDecl: '^4.4.3',
    },
    {
      name: 'shiki',
      kind: 'declared',
      section: 'devDependencies',
      declared: '^4.4.3',
      lockDecl: undefined,
    },
  ]);
});

test('升级声明与 lock 后未重新安装时报告过期包', () => {
  // 复现真实事故形态：package.json 与 lock 已是新版，node_modules 里还是旧版
  const dir = makeProject({
    deps: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    lockEntries: { 'node_modules/@deepseek-ai/dsh': { version: '0.2.1-rc.2' } },
    installed: { '@deepseek-ai/dsh': '0.2.0-rc.2' },
  });
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    { name: '@deepseek-ai/dsh', kind: 'version', lock: '0.2.1-rc.2', installed: '0.2.0-rc.2' },
  ]);
});

test('包缺失与 lock 未记录都视为不同步', () => {
  const dir = makeProject({
    deps: { ws: '^8.0.0', koffi: '^3.0.0' },
    lockEntries: { 'node_modules/ws': { version: '8.21.3' } },
    installed: { koffi: '3.1.6' }, // ws 缺失；koffi 在 lock 中没有记录
  });
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'koffi', kind: 'version', lock: null, installed: '3.1.6' },
    { name: 'ws', kind: 'version', lock: '8.21.3', installed: null },
  ]);
});

test('声明健全但 lock 无记录且本地未装（两空值）不放行', () => {
  // lock 被部分编辑或合并冲突后的残留形态：声明与快照一致，
  // 但安装记录和实际安装双双缺失，不能互相抵消成「一致」
  const dir = makeProject({
    deps: { ws: '^8.0.0' },
    lockEntries: {}, // lock 顶层无 ws 安装记录
    installed: {}, // 本地也未安装
  });
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    { name: 'ws', kind: 'version', lock: null, installed: null },
  ]);
});

test('声明健全但包存在却无 version 字段时视为未同步', () => {
  const dir = makeProject({
    deps: { ws: '^8.0.0' },
    lockEntries: {}, // lock 顶层无记录
    installed: {},
  });
  // 包目录存在，但 package.json 没有 version 字段（version 读出为 null）
  const pkgDir = path.join(dir, 'node_modules', 'ws');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'ws' }));
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    { name: 'ws', kind: 'version', lock: null, installed: null },
  ]);
});

test('包内 package.json 损坏时报可读错误而非崩溃', () => {
  const dir = makeProject({
    deps: { ws: '^8.0.0' },
    lockEntries: { 'node_modules/ws': { version: '8.21.3' } },
    installed: { ws: '8.21.3' },
  });
  fs.writeFileSync(path.join(dir, 'node_modules', 'ws', 'package.json'), '{broken json');
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    { name: 'ws', kind: 'version', lock: '8.21.3', installed: 'package.json 损坏' },
  ]);
});

test('缺少 lock 文件时明确报告而非静默通过', () => {
  const dir = makeProject({ deps: {}, lockEntries: {}, installed: {} });
  fs.rmSync(path.join(dir, 'package-lock.json'));
  const { missingLock } = collectMismatches(dir);
  assert.equal(missingLock, true);
});

test('v1 老格式 lock（无 packages 结构）明确报不可用而非全量误报', () => {
  const dir = makeProject({ deps: { ws: '^8.0.0' }, noPackagesLock: true, installed: { ws: '8.21.3' } });
  const { mismatches, unusableLock } = collectMismatches(dir);
  assert.equal(unusableLock, true);
  assert.deepEqual(mismatches, []);
});
