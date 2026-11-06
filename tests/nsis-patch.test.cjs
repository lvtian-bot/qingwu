'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePatch, applyPatch, reversePatch } = require('diff');
const { patchNsis, ensureNsisPatch } = require('../scripts/patch-nsis.cjs');

const patchText = fs.readFileSync(path.join(__dirname, '../patches/app-builder-lib+26.18.0.patch'), 'utf8');
const base = path.dirname(require.resolve('app-builder-lib/package.json'));

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-patch-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const patch of parsePatch(patchText)) {
    const name = patch.oldFileName.replace('a/node_modules/app-builder-lib/', '');
    const original = applyPatch(fs.readFileSync(path.join(base, name), 'utf8').replaceAll('\r\n', '\n'), reversePatch(patch));
    assert.notEqual(original, false);
    fs.mkdirSync(path.dirname(path.join(temp, name)), { recursive: true });
    fs.writeFileSync(path.join(temp, name), original);
  }
  return { base: temp, patchText, version: '26.18.0' };
}

test('本地打包依赖已具备安装升级补丁', () => {
  ensureNsisPatch(true);
});

test('全新安装应用补丁且重复执行不会叠加修改', (t) => {
  const options = fixture(t);
  assert.throws(() => patchNsis({ ...options, checkOnly: true }), /尚未修正/);
  patchNsis(options);
  patchNsis({ ...options, checkOnly: true });
  patchNsis(options);
  const target = 'templates/nsis/uninstaller.nsh';
  assert.equal(fs.readFileSync(path.join(options.base, target), 'utf8'), fs.readFileSync(path.join(base, target), 'utf8'));
});

test('依赖升级或源模板漂移时拒绝打包且不部分写入', (t) => {
  const options = fixture(t);
  assert.throws(() => patchNsis({ ...options, version: '26.19.0' }), /上游版本/);
  const file = path.join(options.base, 'templates/nsis/include/UAC.nsh');
  fs.appendFileSync(file, '\n# 模拟上游变化\n');
  assert.throws(() => patchNsis(options), /不一致/);
  // 第一份模板仍须保持原样，不能在发现最后一份文件漂移之前写入。
  const first = fs.readFileSync(path.join(options.base, 'templates/nsis/uninstaller.nsh'), 'utf8');
  assert.doesNotMatch(first, /\\\\\?\\/);
});

test('不完整或越界的补丁文件被拒绝', (t) => {
  const options = fixture(t);
  assert.throws(() => patchNsis({ ...options, patchText: '' }), /缺少必要文件/);
  assert.throws(() => patchNsis({ ...options, patchText: patchText.replace('a/node_modules/app-builder-lib/templates/nsis/uninstaller.nsh', 'a/../../outside') }), /未核准/);
});
