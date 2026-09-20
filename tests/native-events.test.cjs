'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const { expandStreamRecords, foldChatItems, foldQueue, foldUserRpcIds } = loadTs('src/renderer/src/native/events.ts');
const { foldPanelData } = loadTs('src/renderer/src/native/panel-data.ts');
const { progressLabel } = loadTs('src/renderer/src/native/TodoPanel.tsx');

const event = (type, data, seq = 1) => ({ type, data, seq, time: seq * 1000 });
const message = (id, text, extra = {}) => ({
  id,
  source: { kind: 'user', rpcId: `request-${id}` },
  content: [{ type: 'text', text }],
  ...extra,
});
const splice = (target, start, removedCount, inserted) => event('agent/inbox/spliced', {
  target, start, removedCount, inserted,
});
const result = (id, text, isError = false) => ({
  message: { content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text }], isError }] },
});

test('重连基线按原顺序还原思考、正文与工具参数增量', () => {
  const start = { type: 'block-start', blockType: 'reasoning', index: 0 };
  const records = [
    { type: 'chunk', chunk: start },
    { type: 'reasoning-chunks', index: 0, texts: ['先看', '材料'] },
    { type: 'text-chunks', index: 1, texts: ['开始处理'] },
    { type: 'tool-call-chunks', index: 2, id: 'call-1', name: 'read', args: ['{"path":', '"a.md"}'] },
  ];
  const before = structuredClone(records);
  assert.deepEqual(expandStreamRecords(records), [
    start,
    { type: 'reasoning-delta', index: 0, text: '先看' },
    { type: 'reasoning-delta', index: 0, text: '材料' },
    { type: 'text-delta', index: 1, text: '开始处理' },
    { type: 'tool-call-delta', index: 2, id: 'call-1', name: 'read', argumentsDelta: '{"path":' },
    { type: 'tool-call-delta', index: 2, id: 'call-1', name: 'read', argumentsDelta: '"a.md"}' },
  ]);
  assert.deepEqual(records, before);
});

test('队列回放恢复编辑、删除与插话位置，保留图片并排除插件消息', () => {
  const attachment = { attachmentId: 'image-1', mediaType: 'image/png', name: '示意图.png', width: 10, height: 20 };
  const queued = message('b', '修订后', { content: [{ type: 'text', text: '修订后' }, { type: 'image', attachment }] });
  const history = [
    splice('next-turn', 0, 0, [message('a', '第一条'), message('b', '第二条')]),
    splice('next-turn', 1, 1, [queued]),
    splice('next-turn', 0, 1, []),
    splice('next-turn', 1, 0, [message('plugin', '上下文', { source: { kind: 'plugin' } })]),
    splice('next-step', 0, 0, [message('c', '现在处理')]),
  ];
  const before = structuredClone(history);
  const restored = foldQueue(history);
  assert.deepEqual(restored.queue.map(({ id, text, placement }) => ({ id, text, placement })), [
    { id: 'b', text: '修订后', placement: 'next-turn' },
    { id: 'c', text: '现在处理', placement: 'next-step' },
  ]);
  assert.deepEqual(restored.queue[0].images, [attachment]);
  assert.deepEqual([...restored.rpcIds], ['request-b', 'request-c']);
  assert.deepEqual(history, before);
});

test('落库与入队请求标识能够退休乐观回显，重复消息不产生重复标识', () => {
  const durable = [
    event('user/message', message('done', '已经发送')),
    event('user/message', message('done', '已经发送')),
    event('assistant/message', { source: { rpcId: 'not-user' } }),
  ];
  const queued = foldQueue([splice('next-turn', 0, 0, [message('waiting', '等待')])]);
  const settled = new Set([...queued.rpcIds, ...foldUserRpcIds(durable)]);
  assert.deepEqual([...settled], ['request-waiting', 'request-done']);
  assert.deepEqual(['request-done', 'request-waiting', 'request-in-flight'].filter((id) => !settled.has(id)), ['request-in-flight']);
});

test('排队与插话模式映射：普通提交归入 next-turn，插话提交归入 next-step', () => {
  const resolveSubmitPlacement = (mode) => (mode === 'steer' ? 'next-step' : 'next-turn');
  assert.equal(resolveSubmitPlacement('queue'), 'next-turn');
  assert.equal(resolveSubmitPlacement('steer'), 'next-step');
  assert.equal(resolveSubmitPlacement(undefined), 'next-turn');
});

test('历史工具结果按调用标识合并，并保留用户附件、思考与中断正文', () => {
  const history = [
    event('turn/start', { turn: 7 }, 1),
    event('user/message', message('a', '请检查', { content: [{ type: 'text', text: '请检查' }, { type: 'image', attachment: { attachmentId: 'pic' } }] }), 2),
    event('tool/call', { callId: 'call-1', name: 'read', arguments: '{}', turn: 7 }, 3),
    event('tool/result', result('call-1', '文件内容'), 4),
    event('assistant/message', { turn: 7, interrupted: true, message: { content: [{ type: 'reasoning', text: '分析' }, { type: 'text', text: '部分回答' }] } }, 5),
  ];
  const before = structuredClone(history);
  const [view] = foldChatItems(history);
  assert.equal(view.turn, 7);
  assert.deepEqual(view.items.map((item) => item.kind), ['user', 'tool', 'assistant']);
  assert.equal(view.items[0].images[0].attachmentId, 'pic');
  assert.equal(view.items[1].tool.pending, false);
  assert.equal(view.items[1].tool.resultText, '文件内容');
  assert.equal(view.items[1].tool.resultTime, 4000);
  assert.equal(view.items[2].text, '部分回答');
  assert.equal(view.items[2].reasoning, '分析');
  assert.equal(view.items[2].interrupted, true);
  assert.equal(view.items[2].startTime, 2000);
  assert.deepEqual(history, before);
});

test('截断历史中的孤立工具结果仍可显示，待完成调用保持等待状态', () => {
  const items = foldChatItems([
    event('tool/result', result('old-call', '失败详情', true)),
    event('tool/call', { callId: 'new-call', name: 'read', arguments: '{}' }, 2),
  ])[0].items;
  assert.equal(items[0].tool.callId, 'old-call');
  assert.equal(items[0].tool.isError, true);
  assert.equal(items[0].tool.pending, false);
  assert.equal(items[1].tool.pending, true);
});

test('完成回合的过程折叠：含思考/工具调用时折叠生效，用户消息与未完成/无过程回合不折叠', () => {
  // 1. 最小事件序列：turn/start → 含 reasoning/text 的 assistant/message → turn/end
  const minimalHistory = [
    event('turn/start', { turn: 1 }, 1),
    event('assistant/message', {
      turn: 1,
      message: {
        content: [
          { type: 'reasoning', text: '深入思考中' },
          { type: 'text', text: '这是最终答复' },
        ],
      },
    }, 2),
    event('turn/end', { turn: 1 }, 3),
  ];
  const [minimalView] = foldChatItems(minimalHistory);
  assert.equal(minimalView.turn, 1);
  assert.equal(minimalView.foldable, true);
  assert.equal(minimalView.answer?.text, '这是最终答复');
  assert.equal(minimalView.answer?.reasoning, '深入思考中');
  assert.equal(minimalView.answer?.tier, 'answer');
  assert.equal(minimalView.context.length, 0);
  assert.equal(minimalView.toolCount, 0);
  assert.equal(minimalView.messageCount, 0);

  // 2. 含用户消息、工具调用、中间消息的完整收束回合
  const fullHistory = [
    event('turn/start', { turn: 2 }, 1),
    event('user/message', message('u1', '请读取文件并总结'), 2),
    event('tool/call', { callId: 'call-1', name: 'read', arguments: '{"file":"a.txt"}', turn: 2 }, 3),
    event('tool/result', result('call-1', '文件正文'), 4),
    event('assistant/message', {
      turn: 2,
      message: { content: [{ type: 'reasoning', text: '整理结论' }, { type: 'text', text: '总结完毕' }] },
    }, 5),
    event('turn/end', { turn: 2 }, 6),
  ];
  const [fullView] = foldChatItems(fullHistory);
  assert.equal(fullView.turn, 2);
  assert.equal(fullView.foldable, true);
  assert.equal(fullView.answer?.text, '总结完毕');
  assert.equal(fullView.toolCount, 1);
  assert.equal(fullView.context.length, 1);
  assert.equal(fullView.context[0].kind, 'tool');
  assert.equal(fullView.context[0].tier, 'context');
  // 用户消息保留在 items 中且不在 context 过程组中
  assert.equal(fullView.items[0].kind, 'user');
  assert.equal(fullView.items[0].tier, undefined);

  // 3. 无过程的回合（纯对话无思考、无工具）：不折叠
  const plainHistory = [
    event('turn/start', { turn: 3 }, 1),
    event('user/message', message('u2', '你好'), 2),
    event('assistant/message', {
      turn: 3,
      message: { content: [{ type: 'text', text: '你好！有什么可以帮你？' }] },
    }, 3),
    event('turn/end', { turn: 3 }, 4),
  ];
  const [plainView] = foldChatItems(plainHistory);
  assert.equal(plainView.turn, 3);
  assert.equal(plainView.foldable, false);

  // 4. 正在运行的回合（未收到 turn/end）：不折叠
  const runningHistory = [
    event('turn/start', { turn: 4 }, 1),
    event('tool/call', { callId: 'call-2', name: 'read', arguments: '{}', turn: 4 }, 2),
    event('assistant/message', {
      turn: 4,
      message: { content: [{ type: 'reasoning', text: '思考中' }, { type: 'text', text: '临时答复' }] },
    }, 3),
  ];
  const [runningView] = foldChatItems(runningHistory);
  assert.equal(runningView.turn, 4);
  assert.equal(runningView.foldable, false);
});

test('面板保留最新任务与同文件修改计数，并排除失败及非法参数调用', () => {
  const call = (callId, name, args) => event('tool/call', { callId, name, arguments: JSON.stringify(args) });
  const todos = [{ content: '核对材料', status: 'completed' }];
  const history = [
    call('todo-old', 'todo_write', { todos: [{ content: '核对材料', status: 'pending' }] }),
    call('edit-1', 'edit', { file_path: 'a.md', old_string: '旧', new_string: '新' }),
    call('write-1', 'write', { file_path: 'a.md', content: '全文' }),
    call('failed', 'write', { file_path: 'b.md', content: '没有写成' }),
    event('tool/result', result('failed', '权限不足', true)),
    event('tool/call', { callId: 'invalid', name: 'write', arguments: '{invalid' }),
    call('todo-new', 'todo_write', { todos }),
  ];
  const before = structuredClone(history);
  assert.deepEqual(foldPanelData(history), {
    todos,
    fileChanges: [{ path: 'a.md', edits: 1, writes: 1, lastEdit: { oldStr: '', newStr: '全文' } }],
  });
  assert.deepEqual(history, before);
});

test('任务进度文案对齐官方格式，按完成、进行中、待处理汇总并省略零项', () => {
  assert.equal(
    progressLabel([
      { content: '任务1', status: 'completed' },
      { content: '任务2', status: 'completed' },
    ]),
    '2 已完成',
  );
  assert.equal(
    progressLabel([
      { content: '任务1', status: 'completed' },
      { content: '任务2', status: 'in_progress' },
      { content: '任务3', status: 'pending' },
    ]),
    '1 已完成 · 1 进行中 · 1 待处理',
  );
  assert.equal(
    progressLabel([
      { content: '任务1', status: 'in_progress' },
      { content: '任务2', status: 'pending' },
    ]),
    '1 进行中 · 1 待处理',
  );
  assert.equal(progressLabel([]), '');
});

