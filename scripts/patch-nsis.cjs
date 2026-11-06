'use strict';

// 版本化修正上游 NSIS 源模板，不修改编译后的安装包。
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parsePatch, applyPatch, reversePatch } = require('diff');

const VERSION = '26.18.0';
const SOURCES = {
  'templates/nsis/uninstaller.nsh': '9ee2dac4593478083e8aa6f8487287ce9401006ccd50ecc538871d133ea4a42c',
  'templates/nsis/include/installUtil.nsh': '97bd546b5cd2aaf16b77bc9e2be8a18962dd74ab5c4d23b35b163ca89bf4dd2a',
  'templates/nsis/include/UAC.nsh': 'abd701f2898f987041baa9d7ece9d0f8ee806eb5f7d85a4f39b6c60b8d638769',
};

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function patchNsis({ base, patchText, version, checkOnly = false }) {
  if (version !== VERSION) throw new Error(`NSIS 补丁需要核对上游版本：预期 ${VERSION}，实际 ${version}`);
  const patches = parsePatch(patchText.replaceAll('\r\n', '\n'));
  if (!patchText.trim()) throw new Error('NSIS 补丁缺少必要文件');
  const pending = [];
  const seen = new Set();
  for (const patch of patches) {
    if (typeof patch.oldFileName !== 'string' || typeof patch.newFileName !== 'string') {
      throw new Error('NSIS 补丁缺少必要文件');
    }
    const relative = patch.oldFileName.replace(/^a\/node_modules\/app-builder-lib\//, '');
    if (!Object.hasOwn(SOURCES, relative) || seen.has(relative) ||
        patch.newFileName !== 'b/node_modules/app-builder-lib/' + relative) {
      throw new Error('NSIS 补丁包含未核准或重复的文件路径');
    }
    seen.add(relative);
    const file = path.join(base, relative);
    const source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    if (hash(source) === SOURCES[relative]) {
      const result = applyPatch(source, patch);
      if (result === false || checkOnly) throw new Error(`NSIS 源模板尚未修正：${relative}，请运行 npm run postinstall`);
      pending.push([file, result]);
    } else {
      const original = applyPatch(source, reversePatch(patch));
      if (original === false || hash(original) !== SOURCES[relative]) {
        throw new Error(`NSIS 源模板与已核准版本不一致：${relative}，需要重新核对补丁`);
      }
    }
  }
  if (seen.size !== Object.keys(SOURCES).length) throw new Error('NSIS 补丁缺少必要文件');
  // 全部校验完成后再落盘，避免部分上游文件漂移时只写入一半补丁。
  for (const [file, result] of pending) fs.writeFileSync(file, result);
}

function ensureNsisPatch(checkOnly = false) {
  const manifest = require.resolve('app-builder-lib/package.json');
  patchNsis({
    base: path.dirname(manifest),
    version: JSON.parse(fs.readFileSync(manifest, 'utf8')).version,
    patchText: fs.readFileSync(path.join(__dirname, '../patches/app-builder-lib+26.18.0.patch'), 'utf8'),
    checkOnly,
  });
}

if (require.main === module) {
  ensureNsisPatch(process.argv.includes('--check'));
  console.log('NSIS 安装与升级源码补丁已核验');
}

module.exports = { patchNsis, ensureNsisPatch };
