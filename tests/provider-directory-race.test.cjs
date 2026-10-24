const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// 目录加载竞态：保存搜索凭据会触发一次外部刷新，两次 loadProviders 重叠且
// 旧请求后完成时，旧回执（配置视图与凭据状态）不得把界面覆盖回旧状态。
// 对应第 21 次复审登记的缺陷；加载真实 hook，RPC 用模拟回执。
function setup() {
  let cursor = 0;
  const hooks = [], effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  let describeRevision = 1;
  let credentialConfigured = false;
  let credentialGate;
  const mod = loadTs("src/renderer/src/native/useProviderDirectory.ts", {
    react: {
      useState(initialValue) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initialValue;
        return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
      },
      useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
      useCallback(fn, deps) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps)) hooks[index] = { fn, deps };
        return hooks[index].fn;
      },
      useEffect(fn, deps) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps)) { hooks[index] = { deps }; effects.push(fn); }
      },
      useMemo(fn, deps) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn(), deps };
        return hooks[index].value;
      },
    },
    "../i18n": { useT: () => (key) => key },
    "./rpc": { async rpc(endpoint) {
      if (endpoint === "llm/listProviders") return [{ id: "deepseek", name: "DeepSeek" }];
      if (endpoint === "llm/listConfigurableProviders") return [{
        provider: "deepseek", displayName: "DeepSeek", settingsNs: "llm-deepseek", settingsPath: [],
      }];
      if (endpoint === "settings/describe") {
        return { writable: true, namespaces: [{ ns: "llm-deepseek", revision: describeRevision, value: {} }] };
      }
      if (endpoint === "credentials/describe") {
        // 到达即捕获当次状态，暂停后放行仍按捕获值返回，模拟旧请求的后到回执
        const configured = credentialConfigured;
        const gate = credentialGate; credentialGate = undefined;
        if (gate) await gate;
        return { DEEPSEEK_API_KEY: { configured, writable: true } };
      }
      throw new Error("unexpected endpoint: " + endpoint);
    } },
  });
  function render() { cursor = 0; return mod.useProviderDirectory({}); }
  return {
    render,
    async mount() { render(); effects.shift()(); await tick(); await tick(); return render(); },
    setCredentialConfigured(value) { credentialConfigured = value; },
    bumpRevision() { describeRevision += 1; },
    blockNextCredential(gate) { credentialGate = gate.promise; },
  };
}

test("目录并发刷新时旧凭据回执不得覆盖新状态", async () => {
  const h = setup(); await h.mount();
  assert.equal(h.render().providerRows[0].credentialConfigured, false);
  // 第一次刷新在凭据查询途中暂停，此刻它读到的是旧状态（未配置）
  const stale = deferred();
  h.blockNextCredential(stale);
  const first = h.render().loadProviders();
  await tick(); await tick();
  // 保存搜索凭据触发第二次刷新：凭据已配置
  h.setCredentialConfigured(true);
  const second = h.render().loadProviders();
  await second; await tick();
  assert.equal(h.render().providerRows[0].credentialConfigured, true);
  // 旧请求此刻才返回"未配置"，不得把界面覆盖回旧状态
  stale.resolve(); await first; await tick();
  assert.equal(h.render().providerRows[0].credentialConfigured, true);
});

test("目录并发刷新时旧配置视图不得覆盖新修订号", async () => {
  const h = setup(); await h.mount();
  assert.equal(h.render().llmViews["llm-deepseek"].revision, 1);
  const stale = deferred();
  h.blockNextCredential(stale);
  const first = h.render().loadProviders();
  await tick(); await tick();
  // 引擎侧配置已更新（修订号 2），第二次刷新读到新视图
  h.bumpRevision();
  const second = h.render().loadProviders();
  await second; await tick();
  assert.equal(h.render().llmViews["llm-deepseek"].revision, 2);
  stale.resolve(); await first; await tick();
  assert.equal(h.render().llmViews["llm-deepseek"].revision, 2);
});
