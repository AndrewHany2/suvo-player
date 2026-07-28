import test from "node:test";
import assert from "node:assert/strict";
import { frameThrottle } from "./frameThrottle.js";

// A manual scheduler: frameThrottle calls schedule(cb); we drain callbacks by
// hand so the test is deterministic (no real rAF/timers).
function manualScheduler() {
  const queue = [];
  const schedule = (cb) => {
    queue.push(cb);
  };
  // Run every callback currently queued (one "frame"). Callbacks that schedule
  // further frames are handled by the next tick() call.
  const tick = () => {
    const batch = queue.splice(0, queue.length);
    for (const cb of batch) cb();
  };
  return { schedule, tick, pending: () => queue.length };
}

test("leading edge fires immediately", () => {
  const { schedule } = manualScheduler();
  const calls = [];
  const t = frameThrottle((x) => calls.push(x), schedule);
  t(1);
  assert.deepEqual(calls, [1], "first call runs synchronously");
});

test("coalesces a burst to leading + latest trailing", () => {
  const { schedule, tick } = manualScheduler();
  const calls = [];
  const t = frameThrottle((x) => calls.push(x), schedule);
  t(1); // leading — runs now
  t(2); // queued
  t(3); // queued (replaces 2)
  assert.deepEqual(calls, [1], "intermediate calls are held, not run");
  tick(); // frame boundary → flush trailing
  assert.deepEqual(calls, [1, 3], "only the latest queued call runs; 2 dropped");
});

test("converges to the final value — no dropped final move", () => {
  const { schedule, tick } = manualScheduler();
  let rendered = null;
  // Simulates the ref-flush pattern: the throttled fn reads a ref.
  let ref = 0;
  const t = frameThrottle(() => { rendered = ref; }, schedule);
  // A held-key burst advancing the ref every "event".
  for (let i = 1; i <= 10; i++) { ref = i; t(); }
  assert.equal(rendered, 1, "leading edge rendered the first position");
  // Drain frames until settled.
  let guard = 0;
  while (rendered !== 10 && guard++ < 20) tick();
  assert.equal(rendered, 10, "final render matches the final ref position");
});

test("settles: no endless rescheduling once calls stop", () => {
  const { schedule, tick, pending } = manualScheduler();
  const t = frameThrottle(() => {}, schedule);
  t();
  t();
  tick(); // flush trailing, schedules one more guard frame
  tick(); // guard frame: nothing queued → pending clears
  assert.equal(pending(), 0, "no frame is left scheduled once idle");
  // A later call starts a fresh leading edge.
  const calls = [];
  const t2 = frameThrottle((x) => calls.push(x), schedule);
  t2("a");
  tick();
  t2("b");
  assert.deepEqual(calls, ["a", "b"], "after idle, next call is leading again");
});

test("cancel drops the pending trailing call", () => {
  const { schedule, tick } = manualScheduler();
  const calls = [];
  const t = frameThrottle((x) => calls.push(x), schedule);
  t(1);
  t(2); // queued
  t.cancel();
  tick();
  assert.deepEqual(calls, [1], "cancelled trailing call never runs");
});
