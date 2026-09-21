'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const {
  sortSessionsByRecency,
  sessionTitle,
  upsertWorkspace,
  orderWorkspaces,
  reorderIds,
  calculateMoveAnchor,
  reorderWorkspaces,
} = loadTs('src/renderer/src/native/sidebar-data.ts');

test('sortSessionsByRecency 按最近更新时间倒序排列会话', () => {
  const sessions = [
    { sessionId: 's1', updatedAt: 1000, running: false, blank: false },
    { sessionId: 's2', updatedAt: 3000, running: false, blank: false },
    { sessionId: 's3', updatedAt: 2000, running: false, blank: false },
  ];

  const sorted = sortSessionsByRecency(sessions);
  assert.deepEqual(
    sorted.map((s) => s.sessionId),
    ['s2', 's3', 's1'],
  );
  // 原数组不被篡改
  assert.equal(sessions[0].sessionId, 's1');
});

test('sortSessionsByRecency 在时间戳相同时以 sessionId 降序稳定平局保序', () => {
  const sessions = [
    { sessionId: 'session-a', updatedAt: 5000, running: false, blank: false },
    { sessionId: 'session-c', updatedAt: 5000, running: false, blank: false },
    { sessionId: 'session-b', updatedAt: 5000, running: false, blank: false },
  ];

  const sorted = sortSessionsByRecency(sessions);
  assert.deepEqual(
    sorted.map((s) => s.sessionId),
    ['session-c', 'session-b', 'session-a'],
  );
});

test('sortSessionsByRecency 能容错处理缺失 updatedAt 的情况', () => {
  const sessions = [
    { sessionId: 's-no-time', running: false, blank: false },
    { sessionId: 's-has-time', updatedAt: 100, running: false, blank: false },
  ];

  const sorted = sortSessionsByRecency(sessions);
  assert.deepEqual(
    sorted.map((s) => s.sessionId),
    ['s-has-time', 's-no-time'],
  );
});

test('sessionTitle 优先使用投影标题，回退 cwd 目录名', () => {
  assert.equal(
    sessionTitle({
      sessionId: 's1',
      updatedAt: 0,
      running: false,
      blank: false,
      projections: { asOfSeq: 1, values: { title: '自定义标题' } },
    }),
    '自定义标题',
  );

  assert.equal(
    sessionTitle({
      sessionId: 's2',
      updatedAt: 0,
      running: false,
      blank: false,
      cwd: 'D:\\projects\\qingwu',
    }),
    'qingwu',
  );

  assert.equal(
    sessionTitle({
      sessionId: 's3',
      updatedAt: 0,
      running: false,
      blank: false,
    }),
    '未命名',
  );
});

test('reorderIds 正确按 insertBefore 语义重排 ID 列表', () => {
  const ids = ['w1', 'w2', 'w3', 'w4'];

  // 将 w3 移到 w1 之前
  assert.deepEqual(reorderIds(ids, 'w3', 'w1'), ['w3', 'w1', 'w2', 'w4']);

  // 将 w1 追加到末尾 (beforeId = undefined)
  assert.deepEqual(reorderIds(ids, 'w1', undefined), ['w2', 'w3', 'w4', 'w1']);

  // 将 w2 移到 w4 之前
  assert.deepEqual(reorderIds(ids, 'w2', 'w4'), ['w1', 'w3', 'w2', 'w4']);

  // 移到自身或相同位置保持不变
  assert.deepEqual(reorderIds(ids, 'w2', 'w2'), ids);

  // 不存在的 id 保持不变
  assert.deepEqual(reorderIds(ids, 'unknown', 'w1'), ids);
  assert.deepEqual(reorderIds(ids, 'w1', 'unknown'), ids);
});

test('calculateMoveAnchor 准确计算前插/后插的参考锚点与有效变动判断', () => {
  const ids = ['A', 'B', 'C', 'D'];

  // C 移到 A 之前 -> before A
  assert.deepEqual(calculateMoveAnchor(ids, 'C', 'A', 'before'), {
    changed: true,
    beforeId: 'A',
  });

  // C 移到 A 之后 -> before B
  assert.deepEqual(calculateMoveAnchor(ids, 'C', 'A', 'after'), {
    changed: true,
    beforeId: 'B',
  });

  // A 移到 D 之后 -> before undefined (末尾)
  assert.deepEqual(calculateMoveAnchor(ids, 'A', 'D', 'after'), {
    changed: true,
    beforeId: undefined,
  });

  // B 原本就在 A 之后，再放到 A 之后无变动
  assert.deepEqual(calculateMoveAnchor(ids, 'B', 'A', 'after'), {
    changed: false,
  });

  // A 原本就在 B 之前，再放到 B 之前无变动
  assert.deepEqual(calculateMoveAnchor(ids, 'A', 'B', 'before'), {
    changed: false,
  });

  // 移到自身无变动
  assert.deepEqual(calculateMoveAnchor(ids, 'B', 'B', 'before'), {
    changed: false,
  });
});

test('reorderWorkspaces 能够乐观原地重排 WorkspaceView 列表', () => {
  const list = [
    { workspaceId: 'w1', title: '项目 1', path: 'D:\\p1', sessionIds: [] },
    { workspaceId: 'w2', title: '项目 2', path: 'D:\\p2', sessionIds: [] },
    { workspaceId: 'w3', title: '项目 3', path: 'D:\\p3', sessionIds: [] },
  ];

  const reordered = reorderWorkspaces(list, 'w3', 'w1');
  assert.deepEqual(
    reordered.map((w) => w.workspaceId),
    ['w3', 'w1', 'w2'],
  );
});
