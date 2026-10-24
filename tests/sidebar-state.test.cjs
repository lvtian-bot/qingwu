"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

const COLLAPSED = "qingwu.native.collapsed-workspaces";
const SECTIONS = "qingwu.native.collapsed-sections";
const originalStorage = global.localStorage;
test.after(() => { global.localStorage = originalStorage; });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function elements(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}

/** 执行实际侧栏、操作 Hook 及渲染函数，只替换 React 调度、存储与引擎边界。 */
function setup(options = {}) {
  const store = new Map([
    [COLLAPSED, JSON.stringify(options.collapsed ?? ["w1", "w2"])],
    [SECTIONS, JSON.stringify(options.sections ?? [])],
    ["qingwu.native.pinned", JSON.stringify({ workspaces: ["w1"], sessions: [] })],
  ]);
  const writes = [];
  global.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem(key, value) { writes.push(key); store.set(key, String(value)); },
  };
  const env = {
    sessions: [1, 2].map((n) => ({ sessionId: `s${n}`, updatedAt: n, blank: false, running: false })),
    workspaces: [1, 2].map((n) => ({ workspaceId: `w${n}`, title: `项目${n}`, path: `D:/p${n}`, sessionIds: [`s${n}`] })),
    currentId: null, activeWorkspaceId: "w1", unread: new Set(), pending: new Map(),
    ...options,
  };
  let cursor = 0, dirty = false;
  const hooks = [], effects = [], calls = [], errors = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value) => {
        const next = typeof value === "function" ? value(hooks[index]) : value;
        if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn(), deps };
      return hooks[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) { hooks[index] = { deps }; effects.push(fn); }
    },
  };
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
  const translate = (key) => key;
  const mocks = { react, "../i18n": { useT: () => translate } };
  const WorkspaceRow = () => null, SessionRow = () => null;
  const { useSessionSidebar, SessionSidebar } = loadTs("src/renderer/src/native/SessionSidebar.tsx", {
    ...mocks, "./SidebarRows": { WorkspaceRow, SessionRow },
    "./PendingInteraction": {}, "./native-icons": { ChevronDownIcon: () => null },
  });
  const { useSessionActions } = loadTs("src/renderer/src/native/useSessionActions.ts", {
    ...mocks, "./rpc": {
      toErrMsg: (err) => err.message,
      async rpc(endpoint, args) {
        calls.push({ endpoint, args });
        if (env.rpc) return env.rpc(endpoint, args);
        if (endpoint === "session/create") return { sessionId: "new-session" };
        if (endpoint === "workspace/delete") return {};
        throw new Error(`未模拟接口 ${endpoint}`);
      },
    },
  });
  const set = (key) => (value) => { env[key] = typeof value === "function" ? value(env[key]) : value; };
  const setError = (err) => errors.push(err);
  function render() {
    let result;
    for (let pass = 0; pass < 10; pass++) {
      cursor = 0; dirty = false;
      const sidebar = useSessionSidebar(env.sessions, env.workspaces, new Set(), env.currentId);
      const actions = useSessionActions({
        sessions: env.sessions, workspaces: env.workspaces, archivedSet: new Set(),
        currentId: env.currentId, activeWorkspaceId: env.activeWorkspaceId,
        workspaceOfSession: new Map(env.workspaces.flatMap((ws) => ws.sessionIds.map((id) => [id, ws.workspaceId]))),
        refreshSessions: async () => {}, setError,
        setSessions: set("sessions"), setWorkspaces: set("workspaces"),
        setArchivedSessionIds: () => {}, setUnreadFinishedSessionIds: set("unread"),
        setCurrentId: set("currentId"), setActiveWorkspaceId: set("activeWorkspaceId"), setSettingsOpen: () => {},
        onWorkspaceSessionCreated: sidebar.expandWorkspace, onWorkspaceDeleted: sidebar.forgetCollapsedWorkspace,
      });
      const view = SessionSidebar({
        state: sidebar, sidebarPanel: { width: 232, resizing: false, onMouseDown() {} },
        collapsed: false, currentId: env.currentId, pendingKindBySession: env.pending,
        unreadFinishedSessionIds: env.unread, ...actions, setError, onOpenSettings() {},
      });
      result = { sidebar, actions, view };
      effects.splice(0).forEach((fn) => fn());
      if (!dirty) return result;
    }
    throw new Error("侧栏未收敛");
  }
  return {
    env, store, writes, calls, errors, render,
    saved: (key = COLLAPSED) => JSON.parse(store.get(key) ?? "[]"),
    rows: (view) => elements(view, (node) => node.type === WorkspaceRow),
    sessions: (view) => elements(view, (node) => node.type === SessionRow),
  };
}

test("启动空列表及首次项目基线不清空保存的收起偏好", () => {
  const h = setup({ workspaces: [] });
  h.render();
  h.env.workspaces = [{ workspaceId: "w1", title: "项目1", path: "D:/p1", sessionIds: ["s1"] }];
  const { sidebar, view } = h.render();
  assert.equal(sidebar.isWorkspaceGroupCollapsed("w1"), true);
  assert.equal(h.rows(view)[0].props.collapsed, true);
  assert.equal(h.sessions(view).some((row) => row.key === "s1"), false);
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  assert.deepEqual(h.writes, []);
});

test("项目标题与列表同步切换，收起时复位手动展示条数", () => {
  const h = setup();
  h.render().sidebar.toggleWorkspaceGroup("w1");
  let state = h.render();
  assert.equal(h.rows(state.view)[0].props.collapsed, false);
  assert.equal(h.sessions(state.view).length, 1);
  state.sidebar.setSessionVisibleCount("w1", 20);
  state = h.render();
  state.sidebar.toggleWorkspaceGroup("w1");
  state = h.render();
  assert.equal(h.rows(state.view)[0].props.collapsed, true);
  assert.equal(state.sidebar.sessionVisibleByGroup.has("w1"), false);
  assert.equal(h.sessions(state.view).length, 0);
});

test("当前项目临时展开且禁用标题切换，离开后恢复保存的收起偏好", () => {
  const h = setup({ currentId: "s1" });
  let state = h.render();
  const row = h.rows(state.view)[0];
  assert.equal(row.props.collapsed, false);
  assert.equal(row.props.toggleDisabled, true);
  row.props.onToggle();
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  assert.deepEqual(h.writes, []);
  h.env.currentId = "s2";
  state = h.render();
  assert.equal(h.rows(state.view)[0].props.collapsed, true);
  assert.equal(h.rows(state.view)[1].props.collapsed, false);
});

test("搜索穿透项目及大分区，点击两个层级均不写入保存偏好", () => {
  const h = setup({ sections: ["pinned", "projects", "sessions"] });
  h.render().sidebar.setSearchText("s");
  // 会话标题回退为 s1/s2，两个项目都参与搜索。
  h.env.sessions = h.env.sessions.map((s) => ({ ...s, projections: { values: { title: s.sessionId } } }));
  let state = h.render();
  assert.equal(h.rows(state.view).length, 2);
  assert.equal(h.sessions(state.view).length, 2);
  for (const row of h.rows(state.view)) {
    assert.equal(row.props.collapsed, false);
    assert.equal(row.props.toggleDisabled, true);
    row.props.onToggle();
  }
  for (const section of ["pinned", "projects", "sessions"]) state.sidebar.toggleSectionCollapse(section);
  const sectionButtons = elements(state.view, (node) => node.props?.className === "native-sidebar-section-toggle");
  assert.ok(sectionButtons.length >= 2);
  sectionButtons.forEach((button) => {
    assert.equal(button.props.disabled, true);
    assert.equal(button.props["aria-expanded"], true);
  });
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  assert.deepEqual(h.saved(SECTIONS), ["pinned", "projects", "sessions"]);
  assert.deepEqual(h.writes, []);
  state.sidebar.setSearchText("");
  state = h.render();
  assert.equal(state.sidebar.isWorkspaceGroupCollapsed("w1"), true);
  assert.equal(h.rows(state.view).length, 0);
});

for (const [name, invoke] of [
  ["置顶项目按钮", (h, state) => h.rows(state.view)[0].props.onNewSession()],
  ["普通项目按钮", (h, state) => h.rows(state.view)[1].props.onNewSession()],
  ["顶部新建按钮", (h, state) => state.actions.handleNewSession()],
  ["首次发送和命令共用的创建入口", (h, state) => state.actions.createSessionIn("w1")],
  ["项目切换入口", (h, state) => state.actions.handleWorkspaceChipPick("w1")],
]) {
  test(`${name}成功后统一展开目标项目`, async () => {
    const h = setup(name === "项目切换入口" ? { currentId: "s2" } : {});
    await invoke(h, h.render());
    await tick();
    h.render();
    const target = name === "普通项目按钮" ? "w2" : "w1";
    assert.equal(h.saved().includes(target), false);
    assert.equal(h.calls.filter((c) => c.endpoint === "session/create").length, 1);
  });
}

test("复用空白会话也展开项目，打开已有会话不改写偏好", async () => {
  const h = setup();
  h.env.sessions = h.env.sessions.map((s) => ({ ...s, blank: s.sessionId === "s1" }));
  const state = h.render();
  state.actions.openSession("s2");
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  assert.equal(await state.actions.createSessionIn("w1"), "s1");
  assert.deepEqual(h.saved(), ["w2"]);
  assert.deepEqual(h.calls, []);
});

test("创建未成功前不改变布局，失败后所有记录保持", async () => {
  const gate = deferred();
  const h = setup({ rpc: () => gate.promise });
  const creating = h.render().actions.createSessionIn("w1");
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  gate.reject(new Error("创建失败"));
  await assert.rejects(creating, /创建失败/);
  h.render();
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  assert.deepEqual(h.writes, []);
});

for (const entry of ["置顶", "普通", "顶部"]) {
  test(`${entry}新建入口失败只报错，不更改布局`, async () => {
    const h = setup({ rpc: async () => { throw new Error("创建失败"); } });
    const state = h.render();
    if (entry === "顶部") await state.actions.handleNewSession();
    else h.rows(state.view)[entry === "置顶" ? 0 : 1].props.onNewSession();
    await tick();
    assert.deepEqual(h.saved(), ["w1", "w2"]);
    assert.deepEqual(h.errors, ["创建失败"]);
    assert.deepEqual(h.writes, []);
  });
}

test("无工作区创建不清理任何项目偏好", async () => {
  const h = setup();
  await h.render().actions.createSessionIn(null);
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  assert.deepEqual(h.writes, []);
});

test("删除失败保留偏好，成功回执才清理", async () => {
  const gate = deferred();
  const h = setup({ rpc: () => gate.promise });
  const deleting = h.render().actions.handleWorkspaceDelete("w1");
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  gate.reject(new Error("删除失败"));
  assert.equal(await deleting, false);
  assert.deepEqual(h.saved(), ["w1", "w2"]);
  h.env.rpc = async () => ({});
  assert.equal(await h.render().actions.handleWorkspaceDelete("w1"), true);
  assert.deepEqual(h.saved(), ["w2"]);
});

for (const streamFirst of [true, false]) {
  test(`删除推送${streamFirst ? "先于" : "晚于"}回执且移除最后一个项目，均完整清理`, async () => {
    const gate = deferred();
    const h = setup({ rpc: () => gate.promise });
    h.env.workspaces = [h.env.workspaces[0]];
    h.render();
    const deleting = h.render().actions.handleWorkspaceDelete("w1");
    if (streamFirst) { h.env.workspaces = []; h.render(); }
    gate.resolve({});
    await deleting;
    if (!streamFirst) h.env.workspaces = [];
    h.render();
    assert.deepEqual(h.saved(), ["w2"]);
  });
}

test("仅流移除最后一个项目也清理，不依赖删除按钮", () => {
  const h = setup();
  h.render();
  h.env.workspaces = [];
  h.render();
  assert.deepEqual(h.saved(), []);
});

test("默认五条，关注会话抬升展示数，搜索显示全部匹配结果", () => {
  const h = setup({ collapsed: [] });
  h.env.sessions = Array.from({ length: 60 }, (_, index) => ({
    sessionId: `s${index}`, updatedAt: 100 - index, running: false, blank: false,
    projections: { values: { title: `测试${index}` } },
  }));
  h.env.workspaces = [{ workspaceId: "w1", title: "项目1", path: "D:/p1", sessionIds: h.env.sessions.map((s) => s.sessionId) }];
  assert.equal(h.sessions(h.render().view).length, 5);
  h.env.pending = new Map([["s12", "approval"]]);
  assert.equal(h.sessions(h.render().view).length, 13);
  h.env.pending = new Map([["s55", "approval"]]);
  assert.equal(h.sessions(h.render().view).length, 5);
  h.render().sidebar.setSearchText("测试");
  assert.equal(h.sessions(h.render().view).length, 60);
});
