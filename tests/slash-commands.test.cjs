'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const {
  detectSlashTrigger,
  filterSlashCommands,
  parseSlashLine,
  mergeCommands,
} = loadTs('src/renderer/src/native/slash-commands.ts');

test('detectSlashTrigger 能够准确识别斜杠触发与参数状态', () => {
  assert.deepEqual(detectSlashTrigger(''), { active: false, query: '' });
  assert.deepEqual(detectSlashTrigger('hello'), { active: false, query: '' });
  assert.deepEqual(detectSlashTrigger('/'), { active: true, query: '' });
  assert.deepEqual(detectSlashTrigger('/co'), { active: true, query: 'co' });
  assert.deepEqual(detectSlashTrigger('/Plan'), { active: true, query: 'plan' });

  // 包含空格时（正在输入参数），不激活斜杠菜单
  assert.deepEqual(detectSlashTrigger('/goal my long term goal'), {
    active: false,
    query: '',
  });

  // 如果光标在空格之前，依然处于激活状态
  assert.deepEqual(detectSlashTrigger('/goal my goal', 4), {
    active: true,
    query: 'goa',
  });
});

test('filterSlashCommands 模糊匹配并按前缀优先级排序', () => {
  const commands = [
    { name: 'compact', description: '压缩以上对话内容' },
    { name: 'plan', description: '进入或退出计划模式' },
    { name: 'goal', description: '设置或查看长期任务目标', hint: '目标描述' },
    { name: 'export', description: '将当前会话内容导出为 ZIP' },
  ];

  // 空 query 返回全部
  assert.equal(filterSlashCommands(commands, '').length, 4);

  // 命中名称前缀
  const resCo = filterSlashCommands(commands, 'co');
  assert.equal(resCo.length, 1);
  assert.equal(resCo[0].name, 'compact');

  // 命中描述中的关键词（例如 zip）
  const resZip = filterSlashCommands(commands, 'zip');
  assert.equal(resZip.length, 1);
  assert.equal(resZip[0].name, 'export');

  // 命中包含但非前缀时按排序规则排在后
  const resP = filterSlashCommands(commands, 'p');
  // 'plan' (前缀), 'export' (包含 'p', 长度6), 'compact' (包含 'p', 长度7)
  assert.equal(resP[0].name, 'plan');
  assert.equal(resP[1].name, 'export');
  assert.equal(resP[2].name, 'compact');
});

test('parseSlashLine 正确解析命令行与参数', () => {
  assert.equal(parseSlashLine(''), null);
  assert.equal(parseSlashLine('normal chat message'), null);

  const bare = parseSlashLine('/compact');
  assert.deepEqual(bare, {
    name: 'compact',
    args: '',
    hasArgs: false,
    rawInput: '',
  });

  const withArgs = parseSlashLine('/goal 完成项目架构梳理');
  assert.deepEqual(withArgs, {
    name: 'goal',
    args: '完成项目架构梳理',
    hasArgs: true,
    rawInput: '完成项目架构梳理',
  });

  const upper = parseSlashLine('/PLAN');
  assert.equal(upper.name, 'plan');
});

test('mergeCommands 保证本地化与宿主优先', () => {
  const hostDescriptors = [
    {
      name: 'compact',
      description: 'Compact older conversation history',
    },
    {
      name: 'custom_host_cmd',
      description: 'A custom command from plugin',
    },
  ];

  const clientCmds = [
    { name: 'model', description: '切换当前会话或默认模型', isClient: true },
    { name: 'compact', description: '客户端重复项', isClient: true },
  ];

  const merged = mergeCommands(hostDescriptors, clientCmds);
  // compact 应该使用中文本地化，且宿主优先（isClient 为 false）
  const compact = merged.find((c) => c.name === 'compact');
  assert.ok(compact);
  assert.equal(compact.description, '压缩以上对话内容');
  assert.equal(compact.isClient, false);

  // model 客户端命令保留
  const model = merged.find((c) => c.name === 'model');
  assert.ok(model);
  assert.equal(model.isClient, true);

  // custom_host_cmd 保留原始 description
  const custom = merged.find((c) => c.name === 'custom_host_cmd');
  assert.ok(custom);
  assert.equal(custom.description, 'A custom command from plugin');
});
