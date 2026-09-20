'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const {
  detectAtTrigger,
  formatFileMention,
} = loadTs('src/renderer/src/native/file-mentions.ts');

test('detectAtTrigger 能够正确识别 @ 与 @" 的触发以及词边界', () => {
  assert.equal(detectAtTrigger('').active, false);
  assert.equal(detectAtTrigger('hello').active, false);

  // 单独 @
  const at1 = detectAtTrigger('@', 1);
  assert.equal(at1.active, true);
  assert.equal(at1.query, '');
  assert.equal(at1.quoted, false);
  assert.equal(at1.span.start, 0);
  assert.equal(at1.span.end, 1);

  // 空格后 @
  const at2 = detectAtTrigger('hello @src/main', 15);
  assert.equal(at2.active, true);
  assert.equal(at2.query, 'src/main');
  assert.equal(at2.quoted, false);
  assert.equal(at2.span.start, 6);
  assert.equal(at2.span.end, 15);

  // 换行后 @
  const at3 = detectAtTrigger('hello\n@doc', 10);
  assert.equal(at3.active, true);
  assert.equal(at3.query, 'doc');
  assert.equal(at3.quoted, false);
  assert.equal(at3.span.start, 6);
  assert.equal(at3.span.end, 10);

  // 邮箱地址或无词边界不触发
  assert.equal(detectAtTrigger('user@example.com', 16).active, false);
  assert.equal(detectAtTrigger('abc@def', 7).active, false);

  // 带引号 @" 触发
  const atQuoted = detectAtTrigger('@"my folder/doc', 15);
  assert.equal(atQuoted.active, true);
  assert.equal(atQuoted.query, 'my folder/doc');
  assert.equal(atQuoted.quoted, true);
  assert.equal(atQuoted.span.start, 0);
  assert.equal(atQuoted.span.end, 15);

  // 空格后 @" 触发
  const atQuotedSpace = detectAtTrigger('see @"some path', 15);
  assert.equal(atQuotedSpace.active, true);
  assert.equal(atQuotedSpace.query, 'some path');
  assert.equal(atQuotedSpace.quoted, true);
  assert.equal(atQuotedSpace.span.start, 4);
  assert.equal(atQuotedSpace.span.end, 15);
});

test('formatFileMention 格式化文件与目录引用语法', () => {
  const file1 = { path: 'src/index.ts', kind: 'file' };
  assert.equal(formatFileMention(file1, false), '@src/index.ts');

  const dir1 = { path: 'src/components', kind: 'directory' };
  assert.equal(formatFileMention(dir1, false), '@src/components/');

  const spaceFile = { path: 'my docs/readme.md', kind: 'file' };
  assert.equal(formatFileMention(spaceFile, false), '@"my docs/readme.md"');

  const spaceDir = { path: 'my docs/notes', kind: 'directory' };
  // 目录在引号中保持开放引号，供下钻继续打字
  assert.equal(formatFileMention(spaceDir, false), '@"my docs/notes/');

  // 显式保留引号 preserveQuote
  assert.equal(formatFileMention(file1, true), '@"src/index.ts"');
  assert.equal(formatFileMention(dir1, true), '@"src/components/');
});
