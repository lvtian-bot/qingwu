'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const { ownerSessionOf, groupPendingEntries } = loadTs(
  'src/renderer/src/native/PendingInteraction.tsx',
  { './markdown': { Markdown: () => null } },
);

const session = (sessionId, extra = {}) => ({
  sessionId,
  updatedAt: 0,
  running: false,
  blank: false,
  ...extra,
});

test('分叉会话的待处理项归到自己，不串到源会话', () => {
  const byId = new Map([
    ['main', session('main')],
    ['branch', session('branch', { parentSessionId: 'main' })],
  ]);
  assert.equal(ownerSessionOf('branch', byId), 'branch');
});

test('子代理会话的待处理项归到可见的父会话', () => {
  const byId = new Map([
    ['main', session('main')],
    [
      'agent',
      session('agent', { origin: 'subagent', parentSessionId: 'main' }),
    ],
  ]);
  assert.equal(ownerSessionOf('agent', byId), 'main');
});

test('子代理挂在分叉会话下时归到分叉会话', () => {
  const byId = new Map([
    ['main', session('main')],
    ['branch', session('branch', { parentSessionId: 'main' })],
    [
      'agent',
      session('agent', { origin: 'subagent', parentSessionId: 'branch' }),
    ],
  ]);
  assert.equal(ownerSessionOf('agent', byId), 'branch');
});

test('嵌套子代理沿父链归到最近的可见会话', () => {
  const byId = new Map([
    ['main', session('main')],
    [
      'agent1',
      session('agent1', { origin: 'subagent', parentSessionId: 'main' }),
    ],
    [
      'agent2',
      session('agent2', { origin: 'subagent', parentSessionId: 'agent1' }),
    ],
  ]);
  assert.equal(ownerSessionOf('agent2', byId), 'main');
});

test('分叉会话的审批归到分叉会话名下', () => {
  const byId = new Map([
    ['main', session('main')],
    ['branch', session('branch', { parentSessionId: 'main' })],
  ]);
  const groups = groupPendingEntries(
    [{ eventId: 'e1', sessionId: 'branch' }],
    [],
    byId,
  );
  assert.equal(groups.orphanPending.length, 0);
  assert.deepEqual([...groups.pendingBySession.keys()], ['branch']);
});

test('归属会话不在列表时按孤儿兜底显示', () => {
  const byId = new Map([['main', session('main')]]);
  const groups = groupPendingEntries([{ eventId: 'e1', sessionId: 'ghost' }], [], byId);
  assert.equal(groups.pendingBySession.size, 0);
  assert.equal(groups.orphanPending.length, 1);
});
