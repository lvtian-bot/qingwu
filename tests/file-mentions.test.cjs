'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const {
  detectAtTrigger,
  formatFileMention,
  formatFileMentionFromPath,
  parseUserTextMentions,
  relativizePathToCwd,
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

test('parseUserTextMentions 将用户文本解析为纯文本与引用药丸', () => {
  assert.deepEqual(parseUserTextMentions(''), []);

  // 纯文本
  const segs1 = parseUserTextMentions('hello world');
  assert.equal(segs1.length, 1);
  assert.equal(segs1[0].kind, 'text');
  assert.equal(segs1[0].raw, 'hello world');

  // 单个普通文件引用
  const segs2 = parseUserTextMentions('请看 @docs/TODO.md 这里的说明');
  assert.equal(segs2.length, 3);
  assert.equal(segs2[0].kind, 'text');
  assert.equal(segs2[0].raw, '请看 ');
  assert.equal(segs2[1].kind, 'file');
  assert.equal(segs2[1].path, 'docs/TODO.md');
  assert.equal(segs2[1].display, 'TODO.md');
  assert.equal(segs2[2].kind, 'text');
  assert.equal(segs2[2].raw, ' 这里的说明');

  // 引号含空格文件与目录
  const segs3 = parseUserTextMentions('请检查 @"my docs/test file.txt" 以及 @src/components/');
  assert.equal(segs3.length, 4);
  assert.equal(segs3[1].kind, 'file');
  assert.equal(segs3[1].path, 'my docs/test file.txt');
  assert.equal(segs3[1].display, 'test file.txt');
  assert.equal(segs3[3].kind, 'directory');
  assert.equal(segs3[3].path, 'src/components/');
  assert.equal(segs3[3].display, 'components/');

  // 邮箱地址不误判
  const segs4 = parseUserTextMentions('邮箱 user@example.com 请忽略');
  assert.equal(segs4.length, 1);
  assert.equal(segs4[0].kind, 'text');
});

test('relativizePathToCwd 能够正确折算相对于 cwd 的路径', () => {
  assert.equal(relativizePathToCwd('D:\\code\\qingwu\\src\\index.ts', 'D:\\code\\qingwu'), 'src/index.ts');
  assert.equal(relativizePathToCwd('D:/code/qingwu/docs/TODO.md', 'D:/code/qingwu/'), 'docs/TODO.md');
  assert.equal(relativizePathToCwd('D:\\code\\qingwu', 'D:\\code\\qingwu'), '.');
  assert.equal(relativizePathToCwd('E:\\other\\file.txt', 'D:\\code\\qingwu'), 'E:/other/file.txt');
  assert.equal(relativizePathToCwd('relative/path.txt', 'D:\\code\\qingwu'), 'relative/path.txt');
  assert.equal(relativizePathToCwd('D:\\code\\qingwu\\path with spaces\\a.txt', 'D:\\code\\qingwu'), 'path with spaces/a.txt');
});

test('formatFileMentionFromPath 能够根据路径与 cwd 生成正确的引用字符串', () => {
  assert.equal(
    formatFileMentionFromPath('D:\\code\\qingwu\\src\\index.ts', 'D:\\code\\qingwu'),
    '@src/index.ts',
  );
  assert.equal(
    formatFileMentionFromPath('D:\\code\\qingwu\\docs folder\\readme.txt', 'D:\\code\\qingwu'),
    '@"docs folder/readme.txt"',
  );
  // 拖放或最终落地插入默认闭合双引号
  assert.equal(
    formatFileMentionFromPath('D:\\code\\qingwu\\docs folder', 'D:\\code\\qingwu', true),
    '@"docs folder/"',
  );
  // 下钻模式可显式指定 closeQuote=false 保持开放引号
  assert.equal(
    formatFileMentionFromPath('D:\\code\\qingwu\\docs folder', 'D:\\code\\qingwu', true, false),
    '@"docs folder/',
  );
  assert.equal(
    formatFileMentionFromPath('my-file.md', 'D:\\code\\qingwu'),
    '@my-file.md',
  );
});
