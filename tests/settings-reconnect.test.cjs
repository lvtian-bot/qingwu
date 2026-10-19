const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

test("设置页每次真实重连都刷新搜索，初次挂载和就绪状态变化不重复读取", (t) => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener() {}, removeEventListener() {},
  } });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete globalThis.window;
  });
  for (const initialConnected of [true, false, undefined]) {
    let cursor = 0, refreshes = 0;
    const hooks = [], effects = [];
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const controller = { loaded: true, keyStatusKnown: true,
      refresh: async () => { refreshes++; }, refreshCredentials: async () => {} };
    const mocks = {
      react: {
        useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value;
          return [hooks[i], (next) => { hooks[i] = typeof next === "function" ? next(hooks[i]) : next; }]; },
        useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
        useCallback(fn, deps) { const i = cursor++;
          if (!same(hooks[i]?.deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
        useEffect(fn, deps) { const i = cursor++;
          if (!same(hooks[i]?.deps, deps)) { hooks[i] = { deps }; effects.push(fn); } },
      },
      "../i18n": { useT: () => (key) => key },
      "./useDshSettings": { useDshSettings: () => ({}) },
      "./useWebSearchSettings": { useWebSearchSettings: () => controller },
    };
    for (const name of ["ModelsTab", "GeneralTab", "ArchivedSessionsTab", "PermissionsTab", "WebSearchTab"]) {
      mocks["./" + name] = { [name]: () => null };
    }
    const { SettingsPage } = loadTs("src/renderer/src/native/SettingsPage.tsx", mocks);
    const onBack = () => {};
    function render(connected) {
      cursor = 0; SettingsPage({ onBack, sidebarPanel: { width: 240 }, dshConnected: connected });
      while (effects.length) effects.shift()();
    }
    render(initialConnected);
    assert.equal(refreshes, 0);
    render(true);
    const initialRefreshes = initialConnected === false ? 1 : 0;
    assert.equal(refreshes, initialRefreshes);
    render(true); controller.loaded = false; controller.keyStatusKnown = false; render(true);
    assert.equal(refreshes, initialRefreshes);
    controller.loaded = true; controller.keyStatusKnown = true;
    for (let reconnect = 1; reconnect <= 2; reconnect++) {
      render(false); render(false); render(true); render(true);
      assert.equal(refreshes, initialRefreshes + reconnect);
    }
  }
});
