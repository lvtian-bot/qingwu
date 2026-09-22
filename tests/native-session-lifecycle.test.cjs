const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

// 只替换 React 调度与宿主边界，执行实际 hooks 和事件折算代码。
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
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}

function draftHarness(sessionId = "A") {
  const h = hookHarness();
  const currentIdRef = { current: sessionId };
  const { useComposerDrafts } = loadTs(
    "src/renderer/src/native/useComposerDrafts.ts",
    {
      react: h.react,
      "./images": {
        isSupportedImage: (file) => file.type === "image/png",
        getImageMediaType: (file) => file.type,
        MAX_IMAGE_BYTES: 20 * 1024 * 1024,
        MAX_IMAGES_PER_MESSAGE: 10,
        fileToBase64: async () => "AQ==",
      },
    },
  );
  const setError = () => {};
  const render = () =>
    h.render(() => useComposerDrafts({ currentIdRef, setError }));
  return {
    render,
    select(id) {
      currentIdRef.current = id;
      render().loadForSession(id);
    },
    submit(targetId = currentIdRef.current) {
      const d = render();
      return d.clearForSubmit(
        targetId,
        d.captureForSubmit(currentIdRef.current),
      );
    },
  };
}

test("A 发送失败时只恢复 A 草稿，B 输入及附件不被覆盖", () => {
  const h = draftHarness();
  h.render().handleInputChange("A 的消息");
  const token = h.submit();
  h.select("B");
  h.render().handleInputChange("B 未完成");
  const images = [{ id: "image-A", previewUrl: "data:image/png;base64,AA==" }];
  h.render().restoreAfterFailure(token, "A 的消息", images);
  assert.equal(h.render().input, "B 未完成");
  assert.deepEqual(h.render().draftImages, []);
  h.select("A");
  assert.equal(h.render().input, "A 的消息");
  assert.deepEqual(h.render().draftImages, images);
});

test("同会话发送后继续编辑或主动清空，旧失败不覆盖新草稿", () => {
  for (const next of ["新输入", ""]) {
    const h = draftHarness();
    h.render().handleInputChange("旧输入");
    const token = h.submit();
    h.render().handleInputChange("新输入");
    h.render().handleInputChange(next);
    h.render().restoreAfterFailure(token, "旧输入", []);
    assert.equal(h.render().input, next);
    h.select("B");
    h.select("A");
    assert.equal(h.render().input, next);
  }
});

test("发送后新加图片使旧回滚失效，图片异步读取不会串入其他会话", async () => {
  const h = draftHarness();
  h.render().handleInputChange("待发送");
  const token = h.submit();
  h.render().handleAddImages([
    new File([new Uint8Array([1])], "新图片.png", { type: "image/png" }),
  ]);
  const imageId = h.render().draftImages[0].id;
  h.select("B");
  await tick();
  h.render().restoreAfterFailure(token, "待发送", []);
  assert.deepEqual(h.render().draftImages, []);
  h.select("A");
  assert.equal(h.render().input, "");
  assert.equal(h.render().draftImages[0].base64, "AQ==");
  h.render().handleRemoveDraftImage(imageId);
  h.render().restoreAfterFailure(token, "待发送", []);
  assert.deepEqual(h.render().draftImages, []);
  assert.equal(h.render().input, "");
});

test("连续发送和删除会话使旧失败恢复凭据失效", () => {
  const h = draftHarness();
  h.render().handleInputChange("第一条");
  const first = h.submit();
  h.render().handleInputChange("第二条");
  const second = h.submit();
  h.render().restoreAfterFailure(first, "第一条", []);
  assert.equal(h.render().input, "");
  h.render().discardFor("A");
  h.render().restoreAfterFailure(second, "第二条", []);
  h.select("A");
  assert.equal(h.render().input, "");
});

test("首次发送清除空白页草稿，失败恢复到创建的会话", () => {
  const h = draftHarness(null);
  h.render().handleInputChange("首次消息");
  const source = h.render().captureForSubmit(null);
  h.select("created");
  const token = h.render().clearForSubmit("created", source);
  h.select(null);
  assert.equal(h.render().input, "");
  h.render().restoreAfterFailure(token, "首次消息", []);
  assert.equal(h.render().input, "");
  h.select("created");
  assert.equal(h.render().input, "首次消息");
});

test("创建会话期间的新编辑与目标会话已有草稿均被保留", () => {
  const h = draftHarness(null);
  h.render().handleInputChange("提交内容");
  const source = h.render().captureForSubmit(null);
  h.render().handleInputChange("等待期间的新输入");
  assert.equal(h.render().clearForSubmit("created", source), null);
  assert.equal(h.render().input, "等待期间的新输入");
  const latest = h.render().captureForSubmit(null);
  h.select("created");
  h.render().handleInputChange("目标原有草稿");
  assert.equal(h.render().clearForSubmit("created", latest), null);
  assert.equal(h.render().input, "目标原有草稿");
  h.select(null);
  assert.equal(h.render().input, "");
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const record = (seq) => ({
  type: "event",
  event: { seq, time: seq, type: "turn/start", data: {} },
});

function streamHarness() {
  const h = hookHarness();
  const listeners = new Set();
  const opens = [];
  const pages = [];
  const errors = [];
  const cancelled = [];
  const currentIdRef = { current: "A" };
  let anchors = 0;
  global.window = {
    qingwu: {
      dshStreamOpen(endpoint, payload) {
        if (endpoint !== "session/follow") return Promise.resolve(endpoint);
        const pending = deferred();
        opens.push({ ...pending, payload });
        return pending.promise;
      },
      dshStreamCancel(id) {
        cancelled.push(id);
      },
      onDshStreamItem(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
  const { useEngineStreams } = loadTs(
    "src/renderer/src/native/useEngineStreams.ts",
    {
      react: h.react,
      "./ContextMeter": { movesContextMeter: () => false },
      "./rpc": {
        toErrMsg: (err) => err.message,
        rpc(endpoint, payload) {
          if (endpoint === "session/page") {
            const pending = deferred();
            pages.push({ ...pending, payload });
            return pending.promise;
          }
          return Promise.resolve([]);
        },
      },
    },
  );
  const options = {
    currentIdRef,
    setCurrentId: (id) => {
      currentIdRef.current = id;
    },
    setError: (error) => errors.push(error),
    onSessionSwitched: () => {},
    onSessionRemoved: () => {},
    capturePrependAnchor: () => {
      anchors++;
    },
  };
  const render = () =>
    h.render(() =>
      useEngineStreams({ ...options, currentId: currentIdRef.current }),
    );
  const emit = (streamId, value) =>
    listeners.forEach((fn) =>
      fn({ streamId, endpoint: "session/follow", value }),
    );
  const snapshot = (streamId, seq = 10) =>
    emit(streamId, {
      type: "snapshot",
      records: [record(seq)],
      cursor: seq,
      hasMore: true,
    });
  return {
    render,
    opens,
    pages,
    errors,
    cancelled,
    emit,
    snapshot,
    get anchors() {
      return anchors;
    },
    select(id) {
      currentIdRef.current = id;
      render();
      h.commit();
      return render();
    },
    async connect(id = "A", streamId = id) {
      this.select(id);
      opens.at(-1).resolve(streamId);
      await tick();
      snapshot(streamId);
      return render();
    },
  };
}

test("A→B→A 后旧翻页响应和旧错误不影响新会话视图", async () => {
  for (const fails of [false, true]) {
    const h = streamHarness();
    await h.connect();
    const pending = h.render().loadOlderHistory();
    assert.equal(h.anchors, 0);
    await h.connect("B");
    await h.connect("A", "A-new");
    if (fails) h.pages[0].reject(new Error("过期错误"));
    else h.pages[0].resolve({ records: [record(1)], hasMore: false });
    await pending;
    assert.deepEqual(
      h.render().eventsRef.current.map((event) => event.seq),
      [10],
    );
    assert.equal(h.render().historyHasMore, true);
    assert.equal(h.anchors, 0);
    assert.deepEqual(h.errors, []);
  }
});

test("重连快照使旧翻页失效，旧 finally 不解除新请求的忙碌状态", async () => {
  const h = streamHarness();
  await h.connect();
  const old = h.render().loadOlderHistory();
  h.snapshot("A", 20);
  const fresh = h.render().loadOlderHistory();
  h.pages[0].resolve({ records: [record(1)], hasMore: false });
  await old;
  assert.equal(h.render().loadingOlderHistory, true);
  assert.deepEqual(
    h.render().eventsRef.current.map((event) => event.seq),
    [20],
  );
  h.pages[1].resolve({ records: [record(11)], hasMore: false });
  await fresh;
  assert.deepEqual(
    h.render().eventsRef.current.map((event) => event.seq),
    [11, 20],
  );
  assert.equal(h.render().loadingOlderHistory, false);
  assert.equal(h.anchors, 1);
});

test("翻页阻止同帧重复提交，只有有效前插才记录滚动锚点", async () => {
  const h = streamHarness();
  await h.connect();
  const api = h.render();
  const first = api.loadOlderHistory();
  await api.loadOlderHistory();
  assert.equal(h.pages.length, 1);
  h.emit("A", { type: "event", event: record(11).event });
  assert.equal(h.anchors, 0);
  h.pages[0].resolve({ records: [record(1)], hasMore: false });
  await first;
  assert.equal(h.anchors, 1);
  assert.deepEqual(
    h.render().eventsRef.current.map((event) => event.seq),
    [1, 10, 11],
  );
});

test("翻页失败或空页不留下滚动锚点，失败后可以重试", async () => {
  const h = streamHarness();
  await h.connect();
  const pending = h.render().loadOlderHistory();
  h.pages[0].reject(new Error("翻页失败"));
  await pending;
  assert.equal(h.render().loadingOlderHistory, false);
  assert.deepEqual(h.errors, ["翻页失败"]);
  const retry = h.render().loadOlderHistory();
  h.pages[1].resolve({ records: [], hasMore: false });
  await retry;
  assert.equal(h.anchors, 0);
  assert.equal(h.render().historyHasMore, false);
});

test("打开会话流失败结束加载并显示错误，切走后的失败不污染新会话", async () => {
  const h = streamHarness();
  h.select("A");
  assert.equal(h.render().loadingHistory, true);
  h.opens[0].reject(new Error("无法订阅"));
  await tick();
  assert.equal(h.render().loadingHistory, false);
  assert.match(h.errors[0], /无法订阅/);
  h.select("B");
  const old = h.opens.at(-1);
  await h.connect("C");
  old.reject(new Error("旧会话打开失败"));
  await tick();
  assert.equal(h.errors.length, 1);
  assert.equal(h.render().loadingHistory, false);
});

test("会话流错误和提前结束解除初始加载，返回空白页同样复位", async () => {
  for (const type of ["stream/error", "stream/end"]) {
    const h = streamHarness();
    h.select("A");
    h.opens[0].resolve("A");
    await tick();
    h.emit("A", { type, error: { message: "数据连接结束" } });
    assert.equal(h.render().loadingHistory, false);
    assert.deepEqual(h.errors, ["数据连接结束"]);
    h.select("B");
    assert.equal(h.render().loadingHistory, true);
    h.select(null);
    assert.equal(h.render().loadingHistory, false);
    h.opens.at(-1).resolve("late-B");
    await tick();
    assert.ok(h.cancelled.includes("late-B"));
  }
});
