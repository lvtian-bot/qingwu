'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { loadTs } = require('./helpers/load-ts.cjs');

const { exportSessionArchive } = loadTs('src/main/session-export.ts');

/**
 * 造一个会话目录：日志按引擎格式写成「头部一帧 + 每条事件一帧」。
 * 这个多帧布局正是当初一次性解压只还原第一行的原因。
 */
function writeSession(root, workspace, sessionId, header, events) {
  const dir = path.join(root, workspace, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [header, ...events].map((line) =>
    zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(line)}\n`)),
  );
  fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), Buffer.concat(frames));
  return dir;
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qw-export-'));
}

test('多帧日志完整解压，不只剩头部', async () => {
  const root = tempRoot();
  const out = path.join(root, 'out');
  writeSession(root, 'ws', 'root-1', { type: 'session', version: 0, id: 'root-1' }, [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, time: 2, data: { turn: 1 } },
  ]);
  const result = await exportSessionArchive(root, 'root-1', out);
  assert.equal(result.ok, true);
  const files = readZip(result.filePath);
  const names = Object.keys(files);
  assert.equal(names.length, 1);
  assert.equal(names[0], 'sessions/root-1/session.jsonl');
  const lines = Buffer.from(files[names[0]]).toString('utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 3);
  assert.ok(lines[2].includes('assistant/message'));
});

test('按父会话关系递归导出全部子会话', async () => {
  const root = tempRoot();
  const out = path.join(root, 'out');
  writeSession(root, 'ws', 'root-1', { type: 'session', version: 0, id: 'root-1' }, []);
  writeSession(
    root,
    'ws',
    'child-1',
    { type: 'session', version: 0, id: 'child-1', parentSessionId: 'root-1' },
    [],
  );
  writeSession(
    root,
    'ws',
    'grand-1',
    { type: 'session', version: 0, id: 'grand-1', parentSessionId: 'child-1' },
    [],
  );
  const result = await exportSessionArchive(root, 'root-1', out);
  assert.equal(result.ok, true);
  assert.equal(result.sessionCount, 3);
  const names = Object.keys(readZip(result.filePath));
  assert.deepEqual(names.sort(), [
    'sessions/child-1/session.jsonl',
    'sessions/grand-1/session.jsonl',
    'sessions/root-1/session.jsonl',
  ]);
});

test('按版本号数值选出最高代次，v10 不会输给 v9', async () => {
  const root = tempRoot();
  const out = path.join(root, 'out');
  const dir = path.join(root, 'ws', 's1');
  fs.mkdirSync(dir, { recursive: true });
  // 只有带后缀的代次：字符串排序会把 v9 排到 v10 前面
  for (const version of [9, 10]) {
    fs.writeFileSync(
      path.join(dir, `session.v${version}.jsonl`),
      `{"type":"session","id":"gen-${version}"}\n`,
    );
  }
  const result = await exportSessionArchive(root, 's1', out);
  assert.equal(result.ok, true);
  const files = readZip(result.filePath);
  const names = Object.keys(files);
  assert.equal(names.length, 1);
  // 选中哪一代，归档里就只有那一份
  assert.equal(names[0], 'sessions/s1/session.v10.jsonl');
  assert.ok(Buffer.from(files[names[0]]).toString('utf8').includes('gen-10'));
});

test('当前代次（无后缀）优先于任何带后缀的旧代次', async () => {
  const root = tempRoot();
  const out = path.join(root, 'out');
  const dir = writeSession(root, 'ws', 's1', { type: 'session', version: 0, id: 'current' }, []);
  fs.writeFileSync(path.join(dir, 'session.v3.jsonl'), '{"type":"session","id":"stale"}\n');
  const result = await exportSessionArchive(root, 's1', out);
  assert.equal(result.ok, true);
  const files = readZip(result.filePath);
  const body = Buffer.from(files['sessions/s1/session.jsonl']).toString('utf8');
  assert.ok(body.includes('"id":"current"'));
  assert.ok(!body.includes('stale'));
});

test('同名导出已存在时不覆盖，改用带序号的名称', async () => {
  const root = tempRoot();
  const out = path.join(root, 'out');
  writeSession(root, 'ws', 's2', { type: 'session', version: 0, id: 's2' }, []);
  const first = await exportSessionArchive(root, 's2', out);
  const second = await exportSessionArchive(root, 's2', out);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.filePath, second.filePath);
  assert.ok(fs.existsSync(first.filePath));
  assert.ok(fs.existsSync(second.filePath));
});

test('同一会话并发导出两次，各自拿到独立文件且都完整', async () => {
  const root = tempRoot();
  const out = path.join(root, 'out');
  writeSession(root, 'ws', 's4', { type: 'session', version: 0, id: 's4' }, [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' } } },
  ]);
  const [first, second] = await Promise.all([
    exportSessionArchive(root, 's4', out),
    exportSessionArchive(root, 's4', out),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.filePath, second.filePath);
  // 两份归档都能解开且内容一致，证明谁也没有覆盖谁
  const linesOf = (result) =>
    Buffer.from(readZip(result.filePath)['sessions/s4/session.jsonl'])
      .toString('utf8')
      .split('\n')
      .filter(Boolean);
  assert.deepEqual(linesOf(first), linesOf(second));
});

test('会话尚未落盘时返回明确失败而不是空压缩包', async () => {
  const root = tempRoot();
  const out = path.join(root, 'out');
  const result = await exportSessionArchive(root, 'missing', out);
  assert.equal(result.ok, false);
  assert.ok(result.message.includes('未找到'));
});

/** 读出 ZIP 内的全部文件（用 fflate 解包，不依赖 cwd，测试并行时也稳定）。 */
function readZip(filePath) {
  const { unzipSync } = require('fflate');
  return unzipSync(new Uint8Array(fs.readFileSync(filePath)));
}
