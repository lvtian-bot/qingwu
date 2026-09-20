const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { loadTs } = require("./helpers/load-ts.cjs");
const { parseDshResponse, parseDshStreamMessage } = loadTs(
  "src/shared/dsh-wire.ts",
);

test("RPC 信封拒绝不匹配回执、缺失结果和畸形错误", () => {
  const valid = (result) => ({
    type: "server-response",
    rpcId: "call-1",
    result,
  });
  assert.deepEqual(
    parseDshResponse(valid({ ok: true, value: { accepted: true } }), "call-1"),
    { ok: true, value: { accepted: true } },
  );
  assert.deepEqual(parseDshResponse(valid({ ok: true }), "call-1"), {
    ok: true,
    value: undefined,
  });
  const failure = {
    ok: false,
    error: {
      code: "settings/conflict",
      message: "冲突",
      details: { actual: 3 },
    },
  };
  assert.deepEqual(parseDshResponse(valid(failure), "call-1"), failure);
  for (const value of [
    null,
    [],
    {},
    valid(null),
    valid({ ok: "true" }),
    valid({ ok: false, error: { message: "缺少 code" } }),
    { ...valid({ ok: true }), rpcId: "other" },
  ]) {
    assert.throws(() => parseDshResponse(value, "call-1"), /引擎响应/);
  }
});

test("mux 只接收已知帧，业务 value 保留未知扩展字段", () => {
  const value = { type: "future/domain-event", extra: [1, null] };
  assert.deepEqual(
    parseDshStreamMessage({ type: "item", streamId: "stream-1", value }),
    { type: "item", streamId: "stream-1", value },
  );
  assert.deepEqual(
    parseDshStreamMessage({ type: "end", streamId: "stream-1" }),
    { type: "end", streamId: "stream-1" },
  );
  assert.equal(
    parseDshStreamMessage({
      type: "error",
      streamId: "stream-1",
      error: { code: "x", message: "失败" },
    }).type,
    "error",
  );
  for (const frame of [
    null,
    [],
    { type: "item", streamId: "" },
    { type: "future", streamId: "stream-1" },
    { type: "error", streamId: "stream-1" },
    {
      type: "error",
      streamId: "stream-1",
      error: { code: 500, message: "失败" },
    },
  ]) {
    assert.throws(() => parseDshStreamMessage(frame), /引擎流信封/);
  }
});

test("审批回执由真实桥发送 args 信封，失败保持可识别，畸形响应不作为成功", async (t) => {
  const { DshBridge } = loadTs("src/main/dsh-bridge.ts");
  const bridge = new DshBridge(
    () => "http://127.0.0.1:3080/",
    () => null,
  );
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    bridge.stop();
  });
  let outcome = {
    ok: false,
    error: { code: "event/not-found", message: "请求已撤销" },
  };
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url.pathname, "/api/$events/result");
    assert.equal(body.type, "client-request");
    assert.equal(body.method, "$events/result");
    assert.deepEqual(body.payload, {
      args: {
        clientId: "client-1",
        eventId: "event-1",
        outcome: { kind: "result", value: "allowed-once" },
      },
    });
    return {
      ok: true,
      json: async () => ({
        type: "server-response",
        rpcId: body.rpcId,
        result: outcome,
      }),
    };
  };
  assert.deepEqual(
    await bridge.eventResult("client-1", "event-1", {
      kind: "result",
      value: "allowed-once",
    }),
    outcome,
  );
  outcome = { ok: "yes" };
  const malformed = await bridge.eventResult("client-1", "event-1", {
    kind: "result",
    value: "allowed-once",
  });
  assert.equal(malformed.ok, false);
  assert.match(malformed.error.message, /格式不合法/);
});

test("真实桥过滤畸形控制帧，并转发业务项和完整的流错误", async (t) => {
  const sockets = [];
  class MockSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      sockets.push(this);
    }
    send() {}
    close() {}
  }
  const delivered = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (channel, item) => delivered.push({ channel, item }) },
  };
  const { DshBridge } = loadTs("src/main/dsh-bridge.ts", { ws: MockSocket });
  const bridge = new DshBridge(
    () => "http://127.0.0.1:3080/",
    () => window,
  );
  t.after(() => bridge.stop());
  bridge.start();
  await Promise.resolve();
  const socket = sockets[0];
  assert.equal(bridge.isConnected(), false);
  socket.emit("open");
  assert.equal(bridge.isConnected(), true);
  const streamId = bridge.openStream("session/follow", {
    request: { address: { kind: "session", sessionId: "s1" } },
  });
  socket.emit(
    "message",
    JSON.stringify({ type: "unexpected", streamId, value: "不能转发" }),
  );
  socket.emit("message", JSON.stringify({ type: "error", streamId }));
  socket.emit(
    "message",
    JSON.stringify({ type: "item", streamId: "unknown", value: "不能转发" }),
  );
  const streamDelivered = () => delivered.filter((d) => d.channel === "dsh:stream-item");
  assert.equal(streamDelivered().length, 0);
  socket.emit(
    "message",
    JSON.stringify({
      type: "item",
      streamId,
      value: { type: "event", event: { seq: 1 } },
    }),
  );
  socket.emit(
    "message",
    JSON.stringify({
      type: "error",
      streamId,
      error: { code: "session/not-found", message: "会话不存在" },
    }),
  );
  assert.equal(streamDelivered().length, 2);
  assert.equal(streamDelivered()[0].item.endpoint, "session/follow");
  assert.equal(streamDelivered()[0].item.value.type, "event");
  assert.deepEqual(streamDelivered()[1].item.value, {
    type: "stream/error",
    error: { code: "session/not-found", message: "会话不存在" },
  });

  // 测试连接关闭与断连状态投递
  socket.emit("close");
  assert.equal(bridge.isConnected(), false);
  const statusDelivered = delivered.filter((d) => d.channel === "dsh:connection-status");
  assert.deepEqual(statusDelivered.map((d) => d.item), [true, false]);
});
