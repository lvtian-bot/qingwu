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

test('detectSlashTrigger 能够准确识别 leading 与 inline 词边界触发', () => {
  assert.equal(detectSlashTrigger('').active, false);
  assert.equal(detectSlashTrigger('hello').active, false);

  // 行首 leading 触发
  const leadingSlash = detectSlashTrigger('/');
  assert.equal(leadingSlash.active, true);
  assert.equal(leadingSlash.position, 'leading');
  assert.equal(leadingSlash.query, '');
  assert.equal(leadingSlash.triggerChar, '/');

  // 中文顿号与全角斜杠 leading 容错
  const commaLeading = detectSlashTrigger('、jh');
  assert.equal(commaLeading.active, true);
  assert.equal(commaLeading.position, 'leading');
  assert.equal(commaLeading.query, 'jh');
  assert.equal(commaLeading.triggerChar, '、');

  // 输入文字后（空格后）inline 触发
  const inlineSlash = detectSlashTrigger('请帮我看一下代码 /comp');
  assert.equal(inlineSlash.active, true);
  assert.equal(inlineSlash.position, 'inline');
  assert.equal(inlineSlash.query, 'comp');
  assert.equal(inlineSlash.span.start, 9);
  assert.equal(inlineSlash.span.end, 14);

  // 换行后 inline 触发
  const newlineSlash = detectSlashTrigger('第一行内容\n/plan');
  assert.equal(newlineSlash.active, true);
  assert.equal(newlineSlash.position, 'inline');
  assert.equal(newlineSlash.query, 'plan');

  // 单词内斜杠或路径（无词边界空格）不误触
  assert.equal(detectSlashTrigger('word/test').active, false);

  // URL 规避：http:// 或 https:// 内部不误触
  assert.equal(detectSlashTrigger('https://example.com/api').active, false);

  // 参数输入中（光标在参数之后），不激活菜单
  assert.equal(detectSlashTrigger('/goal my long term goal').active, false);

  // 光标在空格之前，依然处于激活状态
  const withCaret = detectSlashTrigger('/goal my goal', 4);
  assert.equal(withCaret.active, true);
  assert.equal(withCaret.query, 'goa');
});

test('filterSlashCommands 在 inline 时对齐官方只展示无需参数的命令', () => {
  const commands = [
    {
      name: 'compact',
      label: '压缩',
      description: '压缩以上对话内容',
      section: 'commands',
      tokens: ['压缩', 'ys', 'yasuo'],
    },
    {
      name: 'plan',
      label: '计划',
      description: '进入或退出计划模式',
      section: 'add',
      tokens: ['计划', 'jh', 'jihua'],
    },
    {
      name: 'goal',
      label: '目标',
      description: '设置或查看长期任务目标',
      section: 'add',
      tokens: ['目标', 'mb', 'mubiao'],
      hint: '目标描述',
    },
    {
      name: 'export',
      label: '下载日志',
      description: '将当前会话内容导出为 ZIP',
      section: 'commands',
      tokens: ['导出', '下载', '下载日志'],
    },
  ];

  // leading 位置：返回全部
  assert.equal(filterSlashCommands(commands, '', 'leading').length, 4);

  // inline 位置：自动滤除带 hint 的命令（如 goal）
  const inlineList = filterSlashCommands(commands, '', 'inline');
  assert.equal(inlineList.length, 3);
  assert.equal(inlineList.some((c) => c.name === 'goal'), false);

  // 命中英文名称前缀
  const resCo = filterSlashCommands(commands, 'co', 'inline');
  assert.equal(resCo.length, 1);
  assert.equal(resCo[0].name, 'compact');

  // 命中中文 label / tokens 前缀（输入 "计"）
  const resJi = filterSlashCommands(commands, '计', 'inline');
  assert.equal(resJi.length, 1);
  assert.equal(resJi[0].name, 'plan');

  // 命中中文拼音简写 token（输入 "mb"）
  const resMb = filterSlashCommands(commands, 'mb', 'leading');
  assert.equal(resMb.length, 1);
  assert.equal(resMb[0].name, 'goal');

  // 命中描述中的关键词（例如 zip）
  const resZip = filterSlashCommands(commands, 'zip', 'inline');
  assert.equal(resZip.length, 1);
  assert.equal(resZip[0].name, 'export');
});

test('parseSlashLine 正确解析命令行与参数（支持别名归一化与符号容错）', () => {
  assert.equal(parseSlashLine(''), null);
  assert.equal(parseSlashLine('normal chat message'), null);

  const bare = parseSlashLine('/compact');
  assert.deepEqual(bare, {
    name: 'compact',
    args: '',
    hasArgs: false,
    rawInput: '',
  });

  // 中文顿号容错
  const commaBare = parseSlashLine('、compact');
  assert.deepEqual(commaBare, {
    name: 'compact',
    args: '',
    hasArgs: false,
    rawInput: '',
  });

  // 中文别名归一化（如 /计划 -> plan）
  const chinesePlan = parseSlashLine('/计划');
  assert.deepEqual(chinesePlan, {
    name: 'plan',
    args: '',
    hasArgs: false,
    rawInput: '',
  });

  // 中文别名带参数（如 /目标 梳理系统架构 -> goal）
  const withArgs = parseSlashLine('/目标 完成项目架构梳理');
  assert.deepEqual(withArgs, {
    name: 'goal',
    args: '完成项目架构梳理',
    hasArgs: true,
    rawInput: '完成项目架构梳理',
  });

  const upper = parseSlashLine('/PLAN');
  assert.equal(upper.name, 'plan');
});

test('mergeCommands 保证分组、排序与基线兜底', () => {
  const mergedEmpty = mergeCommands([]);
  assert.ok(mergedEmpty.length >= 7);
  assert.equal(mergedEmpty[0].section, 'add');
  assert.equal(mergedEmpty[0].name, 'goal');

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
    {
      name: 'model',
      label: '模型',
      description: '切换当前会话或默认模型',
      section: 'commands',
      tokens: ['模型'],
      isClient: true,
    },
    {
      name: 'compact',
      label: '压缩',
      description: '客户端重复项',
      section: 'commands',
      tokens: ['压缩'],
      isClient: true,
    },
  ];

  const merged = mergeCommands(hostDescriptors, clientCmds);
  const compact = merged.find((c) => c.name === 'compact');
  assert.ok(compact);
  assert.equal(compact.description, '压缩以上对话内容');
  assert.equal(compact.isClient, false);
  assert.equal(compact.section, 'commands');

  const model = merged.find((c) => c.name === 'model');
  assert.ok(model);
  assert.equal(model.isClient, true);

  const custom = merged.find((c) => c.name === 'custom_host_cmd');
  assert.ok(custom);
  assert.equal(custom.description, 'A custom command from plugin');

  // 测试接入 Skill
  const skills = [
    {
      name: 'office-document-review',
      description: '检查 Word、Excel 和 PowerPoint 文件的内容',
      modelInvocable: true,
    },
    {
      name: 'compact', // 与宿主命令同名
      description: '被遮蔽的同名技能',
      modelInvocable: true,
    },
  ];

  const mergedWithSkills = mergeCommands(hostDescriptors, clientCmds, skills);
  // skills 分组位于 commands 之后
  const skillItem = mergedWithSkills.find((c) => c.name === 'office-document-review');
  assert.ok(skillItem);
  assert.equal(skillItem.section, 'skills');
  assert.equal(skillItem.isSkill, true);

  // 同名 compact 应该保持为 host command
  const compactItem = mergedWithSkills.find((c) => c.name === 'compact');
  assert.ok(compactItem);
  assert.equal(compactItem.isSkill, undefined);
  assert.equal(compactItem.section, 'commands');
});
