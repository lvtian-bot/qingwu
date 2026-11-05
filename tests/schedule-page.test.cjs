"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

function find(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate));
  return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
}

function harness(entries) {
  let cursor = 0;
  const hooks = [], effects = [], listeners = new Map();
  const previousWindow = global.window;
  global.window = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type); },
  };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    Fragment: Symbol.for("react.fragment"),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn(), deps };
      return hooks[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps };
        effects.push(() => { hooks[index].cleanup = fn(); });
      }
    },
  };
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
  const tasks = { entries, loading: false, loadError: null, deleteInactive: async () => 2 };
  const t = (key, values) => values ? `${key}:${JSON.stringify(values)}` : key;
  const { ScheduleTasksPage } = loadTs("src/renderer/src/native/ScheduleTasksPage.tsx", {
    react, "../i18n": { useT: () => t }, "./useScheduleTasks": { useScheduleTasks: () => tasks },
    "./sidebar-data": { sessionTitle: () => "session" },
  });
  let exits = 0;
  const props = { onExit: () => exits++, onOpenSession() {}, onCreateInChat() {} };
  function render(component = ScheduleTasksPage, input = props) {
    cursor = 0;
    const view = component(input);
    effects.splice(0).forEach((run) => run());
    return view;
  }
  return { render, tasks, listeners, resetHooks() { hooks.length = 0; }, get exits() { return exits; }, cleanup() { global.window = previousWindow; } };
}

const base = { id: "1", title: "任务", prompt: "指令", scheduledAt: "2026-11-05T12:00:00Z", target: { kind: "session", sessionId: "s" }, involvedSessionIds: [], status: "ended" };

test("清理确认框优先响应 Esc，完成后显示实际数量", async () => {
  const h = harness([{ ...base, kind: "at" }]);
  try {
    let view = h.render();
    find(view, (n) => n.props?.className === "native-schedule-clear-ended")[0].props.onClick();
    view = h.render();
    h.listeners.get("keydown")({ key: "Escape" });
    assert.equal(h.exits, 0);
    view = h.render();
    assert.equal(find(view, (n) => n.type?.name === "ConfirmDialog").length, 0);
    find(view, (n) => n.props?.className === "native-schedule-clear-ended")[0].props.onClick();
    view = h.render();
    find(view, (n) => n.type?.name === "ConfirmDialog")[0].props.onConfirm();
    await new Promise((resolve) => setImmediate(resolve));
    view = h.render();
    assert.equal(find(view, (n) => n.props?.role === "status")[0].props.children, 'schedule.clear.success:{"count":2}');
    h.listeners.get("keydown")({ key: "Escape" });
    assert.equal(h.exits, 1);
  } finally { h.cleanup(); }
});

test("RRULE 任务能显示并打开，已结束任务时间控件禁用", () => {
  for (const entry of [
    { ...base, kind: "rrule", rrule: "DTSTART:20261105\nRRULE:FREQ=DAILY" },
    { ...base, kind: "weekly", time: "09:00:00", timeZone: "Asia/Shanghai", weekdays: [1] },
  ]) {
    const h = harness([entry]);
    try {
      let view = h.render();
      const row = find(view, (n) => n.type?.name === "ScheduleTaskRow")[0];
      if (entry.kind === "rrule") assert.equal(row.props.frequency, entry.rrule);
      row.props.onToggle();
      view = h.render();
      const detail = find(view, (n) => n.type?.name === "ScheduleTaskDetail")[0];
      // 详情是独立 React 组件，使用另一组 Hook 状态。
      h.resetHooks();
      {
        const body = h.render(detail.type, detail.props);
        if (entry.kind === "rrule") {
          assert.equal(find(body, (n) => n.props?.className === "native-schedule-timing-readonly").length, 1);
        } else {
          const time = find(body, (n) => n.type === "input" && n.props?.type === "time")[0];
          const days = find(body, (n) => typeof n.props?.className === "string" && n.props.className.startsWith("native-schedule-weekday"));
          assert.equal(time.props.disabled, true);
          assert.ok(days.filter((n) => n.type === "button").every((n) => n.props.disabled));
        }
      }
    } finally { h.cleanup(); }
  }
});

test("历史记录未命中显示错误而不是当成记录", async () => {
  const entry = { ...base, kind: "at", status: "active" };
  const h = harness([entry]);
  try {
    h.tasks.loadHistory = async () => ({ id: entry.id, code: "schedule_not_found" });
    let view = h.render();
    find(view, (n) => n.type?.name === "ScheduleTaskRow")[0].props.onToggle();
    view = h.render();
    const detail = find(view, (n) => n.type?.name === "ScheduleTaskDetail")[0];
    h.resetHooks();
    let body = h.render(detail.type, detail.props);
    find(body, (n) => n.props?.className === "native-schedule-history-toggle")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    body = h.render(detail.type, detail.props);
    assert.equal(find(body, (n) => n.props?.className === "native-schedule-error")[0].props.children, "schedule_not_found");
    assert.equal(find(body, (n) => n.props?.className === "native-schedule-history").length, 0);
  } finally { h.cleanup(); }
});

test("暂停任务不显示下次运行，首次投递前不跳转预留会话", () => {
  const h = harness([{ ...base, kind: "at", status: "paused", target: { kind: "new_once", sessionId: "reserved" } }]);
  try {
    const view = h.render();
    const row = find(view, (n) => n.type?.name === "ScheduleTaskRow")[0];
    assert.equal(row.props.onOpenSession, undefined);
    assert.equal(row.props.sessionLabel, "schedule.task.sessionAfterFirstRun");
    h.resetHooks();
    const body = h.render(row.type, row.props);
    assert.equal(find(body, (n) => n.props?.className === "native-schedule-row-next")[0].props.children, null);
  } finally { h.cleanup(); }
});

test("清理执行期间 Esc 不退出任务页或关闭确认框", async () => {
  const h = harness([{ ...base, kind: "at" }]);
  try {
    let complete;
    h.tasks.deleteInactive = () => new Promise((resolve) => { complete = resolve; });
    let view = h.render();
    find(view, (n) => n.props?.className === "native-schedule-clear-ended")[0].props.onClick();
    view = h.render();
    find(view, (n) => n.type?.name === "ConfirmDialog")[0].props.onConfirm();
    view = h.render();
    h.listeners.get("keydown")({ key: "Escape" });
    assert.equal(h.exits, 0);
    view = h.render();
    assert.equal(find(view, (n) => n.type?.name === "ConfirmDialog").length, 1);
    complete(1);
    await new Promise((resolve) => setImmediate(resolve));
  } finally { h.cleanup(); }
});
