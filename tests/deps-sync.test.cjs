'use strict';

// 依赖一致性门禁的核对逻辑：lock 快照与 node_modules 实际版本必须一致，
// 包缺失、版本错位、缺 lock 都要在开工时被识别，避免在过期依赖上开发。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectMismatches } = require('../scripts/check-deps-sync.cjs');

function makeProject(deps, { lockEntries, installed } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-deps-sync-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 't', version: '0.0.0', dependencies: deps }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(
      { name: 't', version: '0.0.0', lockfileVersion: 3, packages: { '': {} , ...lockEntries } },
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

test('lock 与实际版本一致时通过', () => {
  const dir = makeProject(
    { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    {
      lockEntries: { 'node_modules/@deepseek-ai/dsh': { version: '0.2.1-rc.2' } },
      installed: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    },
  );
  const { mismatches, missingLock } = collectMismatches(dir);
  assert.equal(missingLock, false);
  assert.deepEqual(mismatches, []);
});

test('升级声明与 lock 后未重新安装时报告过期包', () => {
  // 复现真实事故形态：lock 已是新版，node_modules 里还是旧版
  const dir = makeProject(
    { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    {
      lockEntries: { 'node_modules/@deepseek-ai/dsh': { version: '0.2.1-rc.2' } },
      installed: { '@deepseek-ai/dsh': '0.2.0-rc.2' },
    },
  );
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches, [
    { name: '@deepseek-ai/dsh', lock: '0.2.1-rc.2', installed: '0.2.0-rc.2' },
  ]);
});

test('包缺失与 lock 未记录都视为不同步', () => {
  const dir = makeProject(
    { ws: '^8.0.0', koffi: '^3.0.0' },
    {
      lockEntries: { 'node_modules/ws': { version: '8.21.3' } },
      installed: { koffi: '3.1.6' }, // ws 缺失；koffi 在 lock 中没有记录
    },
  );
  const { mismatches } = collectMismatches(dir);
  assert.deepEqual(mismatches.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'koffi', lock: null, installed: '3.1.6' },
    { name: 'ws', lock: '8.21.3', installed: null },
  ]);
});

test('缺少 lock 文件时明确报告而非静默通过', () => {
  const dir = makeProject({}, {});
  fs.rmSync(path.join(dir, 'package-lock.json'));
  const { missingLock } = collectMismatches(dir);
  assert.equal(missingLock, true);
});
