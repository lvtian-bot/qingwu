const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");
const fields = loadTs("src/renderer/src/native/web-search-settings.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function initial() {
  return { writable: true, namespaces: [
    { ns: "web", revision: 1, base: { searchProvider: "deepseek-search-api", fetchProvider: "deepseek-fetch-api" },
      value: { searchProvider: "deepseek-search-api", fetchProvider: "deepseek-fetch-api" } },
    { ns: "web-deepseek-api", revision: 2, value: { count: 10, apiKeyEnv: "DEEPSEEK_API_KEY" },
      base: { count: 10, apiKeyEnv: "DEEPSEEK_API_KEY" } },
    { ns: "llm-deepseek", revision: 4, value: { apiKeyEnv: "DEEPSEEK_API_KEY" } },
  ] };
}
function setup(data = initial()) {
  let cursor = 0;
  const hooks = [], effects = [], calls = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  let snapshot = structuredClone(data), credentialGate, readGate, failedNamespace, readError = false, dropCredential = false;
  const credentialStore = { DEEPSEEK_API_KEY: { configured: true, writable: true, source: "stored" } };
  let refreshed = 0;
  const mod = loadTs("src/renderer/src/native/useWebSearchSettings.ts", {
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
    },
    "../i18n": { useT: () => (key) => key },
    "./rpc": { async rpc(endpoint, args) {
      // 测试回执只记录凭据目标，避免断言输出泄露明文输入。
      calls.push({ endpoint, args: endpoint === "credentials/set" ? { ref: args.ref } : args });
      if (endpoint === "settings/describe") {
        if (readError) throw new Error("读取失败");
        const reply = structuredClone(snapshot);
        const gate = readGate; readGate = undefined;
        if (gate) await gate;
        return reply;
      }
      if (endpoint === "credentials/describe") {
        const reply = Object.fromEntries(args.refs.map((ref) => [ref,
          credentialStore[ref] || { configured: false, writable: true, source: "none" }]));
        const gate = credentialGate; credentialGate = undefined;
        if (gate) await gate;
        return reply;
      }
      if (endpoint === "credentials/set") {
        if (dropCredential) return;
        credentialStore[args.ref] = { configured: true, writable: true, source: "stored" }; return;
      }
      if (endpoint === "settings/mutate") {
        if (args.ns === failedNamespace) throw new Error("冲突");
        const ns = snapshot.namespaces.find((n) => n.ns === args.ns);
        assert.equal(args.expectedRevision, ns.revision, "重试必须使用最新修订号");
        for (const op of args.ops) {
          const key = op.path[0];
          if (op.op === "set") ns.value[key] = op.value;
          else if (ns.base && key in ns.base) ns.value[key] = ns.base[key];
          else delete ns.value[key];
          if (key === "apiKey" && op.value === "") ns.secrets = [];
        }
        ns.revision++;
      }
    } },
  });
  function render() { cursor = 0; return mod.useWebSearchSettings({ onRefreshCredentials: () => refreshed++ }); }
  return {
    calls, credentialStore, render, mod, snapshot: () => snapshot, refreshed: () => refreshed,
    async mount() { render(); effects.shift()(); await tick(); return render(); },
    blockCredentials(gate) { credentialGate = gate.promise; },
    blockRead(gate) { readGate = gate.promise; },
    failNamespace(ns) { failedNamespace = ns; },
    failReads(value = true) { readError = value; },
    dropCredentialWrites() { dropCredential = true; },
  };
}
const writes = (h) => h.calls.filter((call) => call.endpoint === "settings/mutate");
function edit(h, name, value) { h.render().edit(name, value); }

test("未改动的设置不会重写；仅改结果条数仍沿用模型密钥", async () => {
  const h = setup(); await h.mount();
  await h.render().save(); assert.equal(writes(h).length, 0);
  edit(h, "limit", "50"); await h.render().save();
  assert.deepEqual(writes(h)[0].args.ops, [{ op: "set", path: ["count"], value: 50 }]);
  assert.equal(h.calls.some((c) => c.endpoint === "credentials/set"), false);
});

test("两种服务的草稿分别保留；Exa 保存只写凭据与服务切换", async () => {
  const h = setup();
  h.credentialStore.EXA_API_KEY = { configured: true, writable: true, source: "stored" };
  await h.mount();
  assert.deepEqual(h.render().availableModes, ["api", "exa"]);
  edit(h, "limit", "30");
  h.render().changeMode("exa");
  edit(h, "apiKeyDraft", "fixture-new-exa");
  h.render().changeMode("api");
  assert.equal(h.render().limit, "30");
  h.render().changeMode("exa");
  assert.equal(h.render().apiKeyDraft, "fixture-new-exa");
  await h.render().save();
  assert.deepEqual(writes(h).map((c) => c.args.ns), ["web"]);
  assert.equal(h.render().mode, "exa");
  assert.equal(h.render().message, "settings.webSearch.exaSavedRestart");
});

test("切换写入失败时不启用服务，选择保留并能重试", async () => {
  const h = setup();
  h.credentialStore.EXA_API_KEY = { configured: true, writable: true, source: "stored" };
  await h.mount();
  h.render().changeMode("exa");
  h.failNamespace("web");
  await h.render().save();
  assert.ok(h.render().error);
  assert.equal(h.render().mode, "exa");
  h.failNamespace(undefined); await h.render().save();
  assert.equal(h.render().error, null);
  assert.equal(h.render().mode, "exa");
});

test("服务设置已成功但切换失败时，重试仅补做服务切换", async () => {
  const data = initial();
  data.namespaces[0].value = { searchProvider: "tavily", fetchProvider: "http" };
  const h = setup(data); await h.mount();
  h.render().changeMode("api"); edit(h, "limit", "6");
  h.failNamespace("web"); await h.render().save();
  assert.ok(h.render().error);
  h.failNamespace(undefined); const count = writes(h).length;
  await h.render().save();
  assert.deepEqual(writes(h).slice(count).map((c) => c.args.ns), ["web"]);
});

test("独立搜索密钥使用独立引用，聊天密钥不改写，成功后清空明文草稿", async () => {
  const h = setup(); await h.mount();
  edit(h, "keySource", "independent"); edit(h, "apiKeyDraft", "fixture-search-value");
  await h.render().save();
  const keyWrites = h.calls.filter((c) => c.endpoint === "credentials/set");
  assert.deepEqual(keyWrites.map((c) => c.args.ref), [fields.SEARCH_SERVICES.api.independentRef]);
  assert.equal(h.render().apiKeyDraft, "");
  assert.equal(h.render().keySource, "independent");
  assert.equal(h.refreshed(), 1);
  assert.equal(h.snapshot().namespaces.find((n) => n.ns === "llm-deepseek").value.apiKeyEnv, "DEEPSEEK_API_KEY");
});

test("预设独立引用与模型重名时，查询并写入不同的搜索引用", async () => {
  const data = initial(), shared = fields.SEARCH_SERVICES.api.independentRef;
  data.namespaces.find((ns) => ns.ns === "llm-deepseek").value.apiKeyEnv = shared;
  data.namespaces.find((ns) => ns.ns === fields.SEARCH_SERVICES.api.ns).value.apiKeyEnv = shared;
  const h = setup(data);
  h.credentialStore[shared] = { configured: true, writable: true, source: "environment" };
  await h.mount();
  edit(h, "keySource", "independent");
  const target = fields.targetKeyRef(data, "api", "independent");
  assert.notEqual(target, shared);
  assert.ok(h.calls.some((c) => c.endpoint === "credentials/describe" && c.args.refs.includes(target)));
  assert.equal(h.render().keyStatusKnown, true);
  assert.equal(h.render().keyWritable, true);
  assert.equal(h.render().hasKey, false);
  edit(h, "apiKeyDraft", "fixture-search-value"); await h.render().save();
  assert.equal(h.render().error, null);
  assert.deepEqual(h.calls.filter((c) => c.endpoint === "credentials/set").map((c) => c.args.ref), [target]);
  assert.deepEqual(h.credentialStore[shared], { configured: true, writable: true, source: "environment" });
  assert.equal(h.snapshot().namespaces.find((ns) => ns.ns === fields.SEARCH_SERVICES.api.ns).value.apiKeyEnv, target);
  edit(h, "keySource", "model"); await h.render().save();
  assert.equal(h.render().hasKey, true);
  assert.equal(h.snapshot().namespaces.find((ns) => ns.ns === fields.SEARCH_SERVICES.api.ns).value.apiKeyEnv, shared);
});

test("独立引用重名且配置只读时，不写模型凭据或无法绑定的新凭据", async () => {
  const data = initial(), shared = fields.SEARCH_SERVICES.api.independentRef;
  data.writable = false;
  data.namespaces[1].value.apiKeyEnv = shared;
  data.namespaces[2].value.apiKeyEnv = shared;
  const h = setup(data); await h.mount();
  edit(h, "keySource", "independent"); edit(h, "apiKeyDraft", "fixture-search-value");
  assert.equal(h.render().keyWritable, false);
  await h.render().save();
  assert.equal(h.render().error, "settings.webSearch.readOnly");
  assert.equal(h.calls.some((c) => c.endpoint === "credentials/set"), false);
  assert.equal(writes(h).length, 0);
});

test("已有独立引用原样复用，原始配置字面密钥在显式切换后停止优先生效", async () => {
  const data = initial(), ns = data.namespaces[1];
  ns.value.apiKeyEnv = "CUSTOM_SEARCH_REF"; ns.secrets = [{ path: ["apiKey"], set: true }];
  const h = setup(data); await h.mount();
  edit(h, "apiKeyDraft", "fixture-replacement"); await h.render().save();
  assert.equal(h.calls.find((c) => c.endpoint === "credentials/set").args.ref, "CUSTOM_SEARCH_REF");
  assert.ok(writes(h)[0].args.ops.some((op) => op.path[0] === "apiKey" && op.value === ""));
  edit(h, "keySource", "model"); await h.render().save();
  assert.equal(h.snapshot().namespaces[1].value.apiKeyEnv, "DEEPSEEK_API_KEY");
});

test("凭据保存成功但绑定失败后，重试不要求再次输入密钥", async () => {
  const h = setup(); await h.mount();
  edit(h, "keySource", "independent"); edit(h, "apiKeyDraft", "fixture-search-value");
  h.failNamespace("web-deepseek-api"); await h.render().save();
  assert.equal(h.render().apiKeyDraft, "");
  assert.equal(h.render().hasKey, true);
  h.failNamespace(undefined); await h.render().save();
  assert.equal(h.render().error, null);
  assert.equal(h.calls.filter((c) => c.endpoint === "credentials/set").length, 1);
});

test("清空条数使用原生 unset，保留引擎继承语义", async () => {
  const h = setup(); await h.mount();
  edit(h, "limit", "");
  await h.render().save();
  assert.deepEqual(writes(h)[0].args.ops, [{ op: "unset", path: ["count"] }]);
  assert.equal(h.render().limit, "10");
});

test("未知提供方或独立抓取搭配不会被保存操作意外改写", async () => {
  for (const value of [
    { searchProvider: "tavily", fetchProvider: "http" },
    { searchProvider: "deepseek-search-api", fetchProvider: "http" },
  ]) {
    const data = initial(); data.namespaces[0].value = value;
    const h = setup(data); await h.mount();
    assert.equal(h.render().mode, "external");
    h.render().changeMode("api");
    assert.equal(h.render().hasExternalConfiguration, true);
    h.render().changeMode("external");
    await h.render().save(); assert.equal(writes(h).length, 0);
  }
});

test("旧版搜索存量可写时静默迁移到新版", async () => {
  const data = initial();
  data.namespaces[0].value = { searchProvider: "deepseek-official", fetchProvider: "http" };
  const h = setup(data); await h.mount();
  const webWrite = writes(h).find((c) => c.args.ns === "web");
  assert.ok(webWrite, "加载时应自动写入迁移");
  assert.deepEqual(webWrite.args.ops, [
    { op: "unset", path: ["searchProvider"] },
    { op: "unset", path: ["fetchProvider"] },
  ]);
  assert.equal(h.render().mode, "api");
  assert.equal(h.snapshot().namespaces[0].value.searchProvider, "deepseek-search-api");
});

test("旧版搜索搭配自定义抓取时不自动迁移，按外部配置展示", async () => {
  const data = initial();
  data.namespaces[0].value = { searchProvider: "deepseek-official", fetchProvider: "custom-fetch" };
  const h = setup(data); await h.mount();
  assert.equal(writes(h).length, 0);
  assert.equal(h.render().mode, "external");
  assert.equal(h.render().externalProvider, "deepseek-official");
});

test("旧版命名空间缺失时不迁移凭据绑定，保持新版继承模型引用", async () => {
  const data = initial();
  data.namespaces[0].value = { searchProvider: "deepseek-official", fetchProvider: "http" };
  data.namespaces[2].value = { apiKeyEnv: "MY_MODEL_KEY" };
  const h = setup(data); await h.mount();
  assert.equal(writes(h).some((c) => c.args.ns === "web-deepseek-api"), false);
  assert.equal(h.render().mode, "api");
});

test("模型密钥引用与 Exa 重名时拒绝保存 Exa 密钥", async () => {
  const data = initial();
  data.namespaces[2].value = { apiKeyEnv: "EXA_API_KEY" };
  const h = setup(data); await h.mount();
  h.render().changeMode("exa");
  edit(h, "apiKeyDraft", "fixture-exa-value");
  await h.render().save();
  assert.equal(h.render().error, "settings.webSearch.exaKeyConflict");
  assert.equal(h.calls.some((c) => c.endpoint === "credentials/set"), false);
  assert.equal(writes(h).length, 0);
});

test("旧版独立搜索引用随迁移绑定到新版，不丢独立鉴权", async () => {
  const data = initial();
  data.namespaces[0].value = { searchProvider: "deepseek-official", fetchProvider: "http" };
  data.namespaces.push({ ns: "web-search-deepseek", revision: 5,
    value: { apiKeyEnv: "QINGWU_DEEPSEEK_MESSAGES_SEARCH_API_KEY", maxUses: 5 }, base: {} });
  const h = setup(data); await h.mount();
  const nsWrites = writes(h);
  const credWrite = nsWrites.find((c) => c.args.ns === "web-deepseek-api");
  assert.deepEqual(credWrite.args.ops, [
    { op: "set", path: ["apiKeyEnv"], value: "QINGWU_DEEPSEEK_MESSAGES_SEARCH_API_KEY" },
  ]);
  assert.ok(nsWrites.findIndex((c) => c.args.ns === "web-deepseek-api")
    < nsWrites.findIndex((c) => c.args.ns === "web"), "凭据绑定先于服务切换");
  assert.equal(h.render().mode, "api");
  assert.equal(h.render().keySource, "independent");
});

test("只读环境不自动迁移旧版，按外部配置展示", async () => {
  const data = initial();
  data.writable = false;
  data.namespaces[0].value = { searchProvider: "deepseek-official", fetchProvider: "http" };
  const h = setup(data); await h.mount();
  assert.equal(writes(h).length, 0);
  assert.equal(h.render().mode, "external");
  assert.equal(h.render().externalProvider, "deepseek-official");
});

test("迁移失败不阻塞加载，可手动切换到新版完成收尾", async () => {
  const data = initial();
  data.namespaces[0].value = { searchProvider: "deepseek-official", fetchProvider: "http" };
  const h = setup(data);
  h.failNamespace("web"); await h.mount();
  assert.equal(h.render().loaded, true);
  assert.equal(h.render().mode, "external");
  h.failNamespace(undefined);
  h.render().changeMode("api");
  await h.render().save();
  assert.equal(h.render().error, null);
  assert.equal(h.render().mode, "api");
});

test("Exa 只有独立密钥：未配置时保存被拒绝且不产生任何写入", async () => {
  const h = setup(); await h.mount();
  h.render().changeMode("exa");
  assert.equal(h.render().keySource, "independent");
  await h.render().save();
  assert.equal(h.render().error, "settings.webSearch.keyRequired");
  assert.equal(writes(h).length, 0);
});

test("Exa 密钥走凭据通道，保存即切换服务并提示重启生效", async () => {
  const h = setup(); await h.mount();
  h.render().changeMode("exa");
  edit(h, "apiKeyDraft", "fixture-exa-value");
  await h.render().save();
  assert.equal(h.calls.find((c) => c.endpoint === "credentials/set").args.ref, "EXA_API_KEY");
  assert.deepEqual(writes(h).find((c) => c.args.ns === "web").args.ops, [
    { op: "set", path: ["searchProvider"], value: "exa" },
    { op: "set", path: ["fetchProvider"], value: "http" },
  ]);
  assert.equal(writes(h).some((c) => c.args.ns === "web-search-exa"), false);
  assert.equal(h.render().mode, "exa");
  assert.equal(h.render().hasKey, true);
  assert.equal(h.render().message, "settings.webSearch.exaSavedRestart");
});

test("刷新和翻译变化保留未保存字段；新的默认值仍能更新未编辑字段", async () => {
  const h = setup(); await h.mount();
  edit(h, "limit", "40");
  h.snapshot().namespaces[1].value.apiKeyEnv = "CUSTOM_SEARCH_REF";
  await h.render().refresh();
  assert.equal(h.render().limit, "40");
  assert.equal(h.render().keySource, "independent");
});

test("完整刷新更新凭据、继承值与修订号，保留草稿并按新修订号保存", async () => {
  const h = setup(); await h.mount();
  edit(h, "limit", "15");
  const ns = h.snapshot().namespaces[1];
  ns.value.count = 12; ns.value.apiKeyEnv = "RECONNECTED_SEARCH_REF"; ns.revision = 20;
  h.credentialStore.RECONNECTED_SEARCH_REF = { configured: true, writable: false, source: "environment" };
  await h.render().refresh();
  assert.equal(h.render().limit, "15");
  assert.equal(h.render().keySource, "independent");
  assert.equal(h.render().hasKey, true);
  assert.equal(h.render().keyWritable, false);
  await h.render().save();
  assert.equal(h.render().error, null);
  assert.equal(writes(h)[0].args.expectedRevision, 20);
  assert.deepEqual(writes(h)[0].args.ops, [{ op: "set", path: ["count"], value: 15 }]);
});

test("初次凭据查询未完成时禁止编辑凭据；后到的旧回执不得覆盖新状态", async () => {
  const h = setup(), gate = deferred();
  h.blockCredentials(gate); await h.mount();
  assert.equal(h.render().keyStatusKnown, false);
  await h.render().refreshCredentials();
  assert.equal(h.render().hasKey, true);
  h.credentialStore.DEEPSEEK_API_KEY = { configured: false, writable: true };
  await h.render().refreshCredentials();
  gate.resolve(); await tick();
  assert.equal(h.render().hasKey, false);
});

test("后发配置刷新优先；旧回读不会覆盖新配置", async () => {
  const h = setup(); await h.mount();
  const gate = deferred(); h.blockRead(gate);
  const old = h.render().refresh();
  h.snapshot().namespaces[1].value.count = 18;
  await h.render().refresh();
  gate.resolve(); await old;
  assert.equal(h.render().limit, "18");
});

test("只读设置仍允许轮换已经绑定的独立凭据，但不允许改绑模型凭据", async () => {
  const data = initial(); data.writable = false;
  data.namespaces[1].value.apiKeyEnv = "CUSTOM_SEARCH_REF";
  const h = setup(data); await h.mount();
  edit(h, "apiKeyDraft", "fixture-search-value"); await h.render().save();
  assert.equal(writes(h).length, 0);
  assert.equal(h.calls.some((c) => c.endpoint === "credentials/set"), true);
  edit(h, "keySource", "model"); await h.render().save();
  assert.ok(h.render().error);
});

test("保存回读失败不会假报成功，恢复连接后保留草稿并可继续", async () => {
  const h = setup(); await h.mount();
  edit(h, "limit", "14"); h.failReads();
  await h.render().save();
  assert.equal(h.render().message, null);
  assert.equal(h.render().loaded, false);
  h.failReads(false); await h.render().refresh();
  assert.equal(h.render().limit, "14");
});

test("连续点击保存只发送一次配置写入", async () => {
  const h = setup(); await h.mount();
  edit(h, "limit", "13");
  const first = h.render().save(), second = h.render().save();
  await Promise.all([first, second]);
  assert.equal(writes(h).length, 1);
});

test("初次配置读取失败时禁止保存，恢复后可以重新读取", async () => {
  const h = setup(); h.failReads(); await h.mount();
  assert.equal(h.render().loaded, false);
  assert.equal(h.render().error, "settings.webSearch.loadFailed");
  await h.render().save(); assert.equal(writes(h).length, 0);
  assert.equal(h.render().error, "settings.webSearch.loadFailed");
  h.failReads(false); await h.render().refresh();
  assert.equal(h.render().loaded, true);
  assert.equal(h.render().error, null);
});

test("配置回读恢复只清除加载错误，仍保留未解决的保存失败提示及草稿", async () => {
  const h = setup(); await h.mount();
  edit(h, "limit", "17"); h.failNamespace("web-deepseek-api");
  await h.render().save();
  assert.equal(h.render().error, "settings.webSearch.saveFailed");
  h.failReads(); await h.render().refresh();
  assert.equal(h.render().loaded, false);
  h.failReads(false); await h.render().refresh();
  assert.equal(h.render().loaded, true);
  assert.equal(h.render().error, "settings.webSearch.saveFailed");
  assert.equal(h.render().limit, "17");
});

test("凭据回读未配置时保存失败，不启用服务，也不清除待重试的输入", async () => {
  const h = setup(); await h.mount(); h.dropCredentialWrites();
  edit(h, "keySource", "independent"); edit(h, "apiKeyDraft", "fixture-search-value");
  await h.render().save();
  assert.equal(h.render().message, null);
  assert.ok(h.render().error);
  assert.ok(h.render().apiKeyDraft.length > 0);
  assert.equal(writes(h).length, 0);
});

test("结果条数范围遵循 1–50，非法输入拒绝", () => {
  for (const limit of ["0", "51", "1.5", "bad"]) {
    assert.equal(fields.validateDraft({ limit, keySource: "model", apiKeyDraft: "" }), "invalidLimit");
  }
  assert.equal(fields.validateDraft({ limit: "50", keySource: "model", apiKeyDraft: "" }), null);
});
