const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

function setup() {
  let cursor = 0;
  const state = [];
  const effects = [];
  const calls = [];
  let snapshot = {
    writable: true,
    namespaces: [
      { ns: "permission", revision: 4, value: { defaultPreset: "standard" } },
      { ns: "agent-default-model", revision: 7, value: { provider: "demo", model: "old" } },
    ],
  };
  let writeError = false;
  let readError = false;
  const { useDshSettings } = loadTs("src/renderer/src/native/useDshSettings.ts", {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value) => { state[index] = value; }];
      },
      useCallback: (callback) => callback,
      useEffect: (effect) => { effects.push(effect); },
    },
    "./rpc": {
      async rpc(endpoint, args) {
        calls.push({ endpoint, args });
        if (endpoint === "settings/describe") {
          if (readError) throw new Error("读取失败");
          return snapshot;
        }
        if (writeError) throw new Error("保存失败");
        snapshot = { ...snapshot, namespaces: snapshot.namespaces.map((ns) =>
          ns.ns !== args.ns ? ns : {
            ...ns,
            revision: ns.revision + 1,
            value: endpoint === "settings/mutate" ? {} : args.patch,
          },
        ) };
      },
    },
  });
  const render = () => { cursor = 0; return useDshSettings(); };
  return {
    render, calls,
    async mount() {
      render();
      effects.shift()();
      await new Promise((resolve) => setImmediate(resolve));
      return render();
    },
    failWrites() { writeError = true; },
    failReads() { readError = true; },
  };
}

test("默认模型恢复使用引擎 unset 并携带修订号，刷新无模型时清除旧显示", async () => {
  const h = setup();
  const settings = await h.mount();
  assert.equal(settings.defaultModelKey, "demo/old");
  await settings.saveDefaultModel("");
  assert.deepEqual(h.calls.find((call) => call.endpoint === "settings/mutate").args, {
    ns: "agent-default-model",
    ops: [{ op: "unset", path: ["provider"] }, { op: "unset", path: ["model"] }],
    expectedRevision: 7,
  });
  assert.equal(h.render().defaultModelKey, "");
});

test("模型与权限保存失败保持实际值，并重新读取配置", async () => {
  const h = setup();
  const settings = await h.mount();
  h.failWrites();
  await settings.saveDefaultModel("demo/new");
  await h.render().saveDefaultPreset("elevated");
  const next = h.render();
  assert.equal(next.defaultModelKey, "demo/old");
  assert.equal(next.defaultPreset, "standard");
  assert.match(next.settingsMessage, /更新失败/);
  assert.equal(h.calls.filter((call) => call.endpoint === "settings/describe").length, 3);
});

test("成功保存仍保留含斜杠模型 ID 的完整内容", async () => {
  const h = setup();
  const settings = await h.mount();
  await settings.saveDefaultModel("demo/family/model");
  assert.equal(h.render().defaultModelKey, "demo/family/model");
  assert.deepEqual(h.calls.find((call) => call.endpoint === "settings/update").args.patch,
    { provider: "demo", model: "family/model" });
});
