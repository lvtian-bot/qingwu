'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

// Mock localStorage
const storage = new Map();
global.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  },
};

const {
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_LAST_WIDTH_KEY,
  getLastPanelWidth,
  saveLastPanelWidth,
  defaultPanelLayout,
  loadPanelLayout,
  savePanelLayout,
} = loadTs('src/renderer/src/native/panel/layout.ts');

test('PANEL_DEFAULT_WIDTH 初始默认宽度为 600px', () => {
  assert.equal(PANEL_DEFAULT_WIDTH, 600);
  assert.equal(PANEL_MIN_WIDTH, 240);
  assert.equal(PANEL_MAX_WIDTH, 720);
});

test('getLastPanelWidth 在无全局记录时返回默认宽度 600px', () => {
  storage.clear();
  assert.equal(getLastPanelWidth(), 600);
});

test('saveLastPanelWidth 与 getLastPanelWidth 跨会话存取并约束在合法区间', () => {
  storage.clear();
  saveLastPanelWidth(650);
  assert.equal(getLastPanelWidth(), 650);
  assert.equal(storage.get(PANEL_LAST_WIDTH_KEY), '650');

  // 超出上限 720 被截断
  saveLastPanelWidth(800);
  assert.equal(getLastPanelWidth(), 720);

  // 低于下限 240 被截断
  saveLastPanelWidth(150);
  assert.equal(getLastPanelWidth(), 240);
});

test('defaultPanelLayout 优先使用全局最近宽度', () => {
  storage.clear();
  assert.equal(defaultPanelLayout().width, 600);

  saveLastPanelWidth(680);
  assert.equal(defaultPanelLayout().width, 680);
});

test('loadPanelLayout 在无会话记录或无保存宽度时优先读取全局最近宽度', () => {
  storage.clear();
  saveLastPanelWidth(660);

  // 无记录会话
  const layout = loadPanelLayout('session-new');
  assert.equal(layout.width, 660);

  // 记录存在但无 width 字段
  storage.set('qingwu.panel.layout.session-no-width', JSON.stringify({
    expanded: true,
    fullscreen: false,
    tabs: [],
    activeTabId: null,
  }));
  const layoutNoWidth = loadPanelLayout('session-no-width');
  assert.equal(layoutNoWidth.width, 660);
});

test('loadPanelLayout 恢复老旧数据时将窄于默认值的宽度抬升至新默认 600px', () => {
  storage.clear();
  // 旧版本保存的 500px 默认值
  storage.set('qingwu.panel.layout.session-old', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 500,
    tabs: [],
    activeTabId: null,
  }));
  const layout = loadPanelLayout('session-old');
  assert.equal(layout.width, 600);
});

test('loadPanelLayout 正常保留用户在合法范围内保存的宽度', () => {
  storage.clear();
  storage.set('qingwu.panel.layout.session-wide', JSON.stringify({
    expanded: true,
    fullscreen: false,
    width: 688,
    tabs: [],
    activeTabId: null,
  }));
  const layout = loadPanelLayout('session-wide');
  assert.equal(layout.width, 688);
});

test('savePanelLayout 仅写入会话独立存储，不覆盖全局最近宽度', () => {
  storage.clear();
  // 用户之前显式调整到 680px
  saveLastPanelWidth(680);
  assert.equal(getLastPanelWidth(), 680);

  // 访问/保存带有 600px 的旧会话布局
  savePanelLayout('session-1', {
    expanded: true,
    fullscreen: false,
    width: 600,
    tabs: [],
    activeTabId: null,
  });

  // 会话独立存储正常记录 600px
  const sessionSaved = JSON.parse(storage.get('qingwu.panel.layout.session-1'));
  assert.equal(sessionSaved.width, 600);

  // 全局最近宽度依然保持为用户显式调整的 680px，不被常规保存污染
  assert.equal(storage.get(PANEL_LAST_WIDTH_KEY), '680');
  assert.equal(getLastPanelWidth(), 680);
});
