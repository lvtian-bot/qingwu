const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));

// 供应商目录的桌面版对齐口径：账号通道按可用性呈现并排在最前，内置 DeepSeek
// 次之；删除资格只看「配置是否由用户添加」，内置通道不可删。加载真实 hook，
// RPC 回执模拟引擎目录（内置两条 DeepSeek 通道 + 用户添加的 pi-ai 两条）。
function setup() {
  let cursor = 0;
  const hooks = [], effects = [];
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const mod = loadTs("src/renderer/src/native/useProviderDirectory.ts", {
    react: {
      useState(initialValue) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initialValue;
        return [
          hooks[index],
          (value) => {
            hooks[index] = typeof value === "function" ? value(hooks[index]) : value;
          },
        ];
      },
      useRef(value) {
        const index = cursor++;
        return (hooks[index] ??= { current: value });
      },
      useCallback(fn, deps) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps)) hooks[index] = { fn, deps };
        return hooks[index].fn;
      },
      useEffect(fn, deps) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps)) {
          hooks[index] = { deps };
          effects.push(fn);
        }
      },
      useMemo(fn, deps) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn(), deps };
        return hooks[index].value;
      },
    },
    "../i18n": { useT: () => (key) => key },
    "./rpc": {
      async rpc(endpoint) {
        if (endpoint === "llm/listProviders")
          return [
            { id: "deepseek-official", name: "DeepSeek" },
            { id: "deepseek-account", name: "DeepSeek Account" },
            { id: "deepseek", name: "deepseek" },
            { id: "google", name: "google" },
          ];
        if (endpoint === "llm/listConfigurableProviders")
          return [
            { provider: "deepseek-official", displayName: "DeepSeek", settingsNs: "llm-deepseek", settingsPath: [] },
            { provider: "deepseek-account", displayName: "DeepSeek Account", settingsNs: "llm-deepseek-account", settingsPath: [] },
            { provider: "deepseek", displayName: "deepseek", settingsNs: "llm-pi-ai", settingsPath: ["providers", "deepseek"] },
            { provider: "google", displayName: "google", settingsNs: "llm-pi-ai", settingsPath: ["providers", "google"] },
          ];
        if (endpoint === "settings/describe")
          return {
            writable: true,
            namespaces: [
              { ns: "llm-deepseek", revision: 1, value: {} },
              { ns: "llm-deepseek-account", revision: 1, value: {} },
              {
                ns: "llm-pi-ai",
                revision: 1,
                value: {
                  providers: {
                    deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY" },
                    google: { apiKeyEnv: "GOOGLE_API_KEY" },
                  },
                },
              },
            ],
          };
        if (endpoint === "credentials/describe")
          return {
            DEEPSEEK_API_KEY: { configured: true, writable: true },
            GOOGLE_API_KEY: { configured: true, writable: true },
          };
        throw new Error("unexpected endpoint: " + endpoint);
      },
    },
  });
  function render(options) {
    cursor = 0;
    return mod.useProviderDirectory(options);
  }
  function drainEffects() {
    const pending = effects.splice(0);
    for (const fn of pending) fn();
  }
  return {
    render,
    async mount(options) {
      render(options);
      drainEffects();
      await tick();
      await tick();
      return render(options);
    },
    async settle(options) {
      const state = render(options);
      drainEffects();
      await tick();
      await tick();
      return render(options) ?? state;
    },
  };
}

test("账号通道未登录时不呈现，已添加列表按内置 DeepSeek 优先", async () => {
  const h = setup();
  const state = await h.mount({ accountAvailable: false });
  assert.deepEqual(
    state.addedRows.map((row) => row.provider),
    ["deepseek-official", "deepseek", "google"],
  );
  assert.deepEqual(
    state.availableRows.map((row) => row.provider),
    [],
  );
  // 未登录时不参与默认选中
  assert.equal(state.selectedRow?.provider, "deepseek-official");
});

test("账号通道已登录时排在最前，内置 DeepSeek 次之，其余保持目录顺序", async () => {
  const h = setup();
  const state = await h.mount({ accountAvailable: true });
  assert.deepEqual(
    state.addedRows.map((row) => row.provider),
    ["deepseek-account", "deepseek-official", "deepseek", "google"],
  );
});

test("删除资格只看是否用户添加：pi-ai 通道可删，两条内置通道不可删", async () => {
  const h = setup();
  let state = await h.mount({ accountAvailable: true });

  state.selectProvider("deepseek");
  state = h.render({ accountAvailable: true });
  assert.equal(state.selectedRow?.provider, "deepseek");
  assert.equal(state.isSelectedRemovable, true);

  state.selectProvider("deepseek-official");
  state = h.render({ accountAvailable: true });
  assert.equal(state.isSelectedRemovable, false);

  state.selectProvider("deepseek-account");
  state = h.render({ accountAvailable: true });
  assert.equal(state.isSelectedRemovable, false);
});

test("账号通道退出登录后，选中回落到首个已添加的内置通道", async () => {
  const h = setup();
  let state = await h.mount({ accountAvailable: true });
  state.selectProvider("deepseek-account");
  state = h.render({ accountAvailable: true });
  assert.equal(state.selectedRow?.provider, "deepseek-account");

  state = await h.settle({ accountAvailable: false });
  assert.equal(state.selectedRow?.provider, "deepseek-official");
});
