"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

// 只替换 React 调度：直接执行实际 hooks 与列表刷新逻辑。
function hookHarness() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: initial };
        slot.set = (next) => {
          slot.value = typeof next === "function" ? next(slot.value) : next;
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          slots[i].cleanup = fn();
        });
      }
    },
  };
  return {
    react,
    render(fn) {
      cursor = 0;
      return fn();
    },
    commit() {
      const pending = effects;
      effects = [];
      pending.forEach((fn) => fn());
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function engineHarness(rpcImpl) {
  const h = hookHarness();
  const currentIdRef = { current: "A" };
  const errors = [];
  global.window = {
    qingwu: {
      // 订阅保持挂起：本文件只关心会话列表与投影补回，不触发 follow 帧。
      dshStreamOpen: () => new Promise(() => {}),
      dshStreamCancel: () => {},
      onDshStreamItem: () => () => {},
    },
  };
  const { useEngineStreams } = loadTs(
    "src/renderer/src/native/useEngineStreams.ts",
    {
      react: h.react,
      "./ContextMeter": { movesContextMeter: () => false },
      "./rpc": { toErrMsg: (err) => err.message, rpc: rpcImpl },
    },
  );
  const render = () =>
    h.render(() =>
      useEngineStreams({
        currentId: currentIdRef.current,
        currentIdRef,
        setCurrentId: () => {},
        setError: (message) => errors.push(message),
        onSessionSwitched: () => {},
        onSessionRemoved: () => {},
        capturePrependAnchor: () => {},
      }),
    );
  return { h, errors, render };
}

test("会话列表摘要不含上下文投影时，由单会话完整投影补回占用数据", async () => {
  const h = engineHarness((endpoint) => {
    if (endpoint === "session/list")
      return Promise.resolve({
        items: [
          {
            sessionId: "A",
            updatedAt: 1,
            running: false,
            blank: false,
            projections: { asOfSeq: 5, values: { title: "会话 A" } },
          },
        ],
      });
    if (endpoint === "session/projections")
      return Promise.resolve({
        kind: "sequenced",
        asOfSeq: 6,
        values: {
          contextPressure: {
            pressureTokens: 1000,
            projectedTokens: 1200,
            contextWindow: 10000,
          },
          contextBreakdown: {
            systemTokens: 100,
            toolsTokens: 200,
            messageTokens: 300,
          },
        },
      });
    return Promise.resolve(null);
  });
  h.render();
  h.h.commit();
  await tick();
  const [session] = h.render().sessions;
  // 列表原有字段保留，上下文占用与构成由完整投影补回。
  assert.equal(session.projections.values.title, "会话 A");
  assert.deepEqual(session.projections.values.contextPressure, {
    pressureTokens: 1000,
    projectedTokens: 1200,
    contextWindow: 10000,
  });
  assert.deepEqual(session.projections.values.contextBreakdown, {
    systemTokens: 100,
    toolsTokens: 200,
    messageTokens: 300,
  });
  assert.deepEqual(h.errors, []);
});

test("完整投影读取失败只影响占用数据，不影响会话列表刷新", async () => {
  const h = engineHarness((endpoint) => {
    if (endpoint === "session/list")
      return Promise.resolve({
        items: [
          {
            sessionId: "A",
            updatedAt: 2,
            running: false,
            blank: false,
            projections: { asOfSeq: 3, values: { title: "会话 A" } },
          },
        ],
      });
    return Promise.reject(new Error("投影读取失败"));
  });
  h.render();
  h.h.commit();
  await tick();
  const [session] = h.render().sessions;
  assert.equal(session.projections.values.title, "会话 A");
  assert.equal(session.projections.values.contextPressure, undefined);
  assert.deepEqual(h.errors, []);
});
