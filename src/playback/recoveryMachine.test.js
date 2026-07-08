import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  reduce,
  initialState,
  BUFFERING_DOWNGRADE_THRESHOLD,
  MAX_LOAD_ATTEMPTS,
} from "./recoveryMachine.js";

/** Find the first effect of a given type. */
function effect(effects, type) {
  return effects.find((e) => e.type === type);
}

describe("initialState", () => {
  test("defaults", () => {
    const s = initialState();
    assert.equal(s.state, "idle");
    assert.equal(s.isLive, false);
    assert.equal(s.savedTime, 0);
    assert.equal(s.attemptCount, 0);
    assert.equal(s.qualityCap, "auto");
  });

  test("honors isLive and startTime", () => {
    const s = initialState({ isLive: true, startTime: 42 });
    assert.equal(s.isLive, true);
    assert.equal(s.savedTime, 42);
  });
});

describe("happy path", () => {
  test("LOAD -> loading, PLAYING -> playing", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    assert.equal(s.state, "loading");
    s = reduce(s, { type: "PLAYING" }).state;
    assert.equal(s.state, "playing");
  });

  test("PROGRESS saves currentTime", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 123 }).state;
    assert.equal(s.savedTime, 123);
  });
});

describe("self-recovery cancels a pending retry", () => {
  test("PLAYING after a STALL emits HIDE_RECONNECTING + CANCEL_RETRY", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    // A transient buffering blip schedules a retry and enters recovering.
    const stall = reduce(s, { type: "STALL" });
    assert.equal(stall.state.state, "recovering");
    assert.ok(effect(stall.effects, "SCHEDULE_RETRY"));
    // Stream recovers on its own — the scheduled retry must be cancelled.
    const r = reduce(stall.state, { type: "PLAYING" });
    assert.equal(r.state.state, "playing");
    assert.ok(effect(r.effects, "HIDE_RECONNECTING"));
    assert.ok(effect(r.effects, "CANCEL_RETRY"));
  });

  test("RECOVERED emits CANCEL_RETRY", () => {
    let s = initialState();
    s = reduce(s, { type: "STALL" }).state;
    const r = reduce(s, { type: "RECOVERED" });
    assert.equal(r.state.state, "playing");
    assert.ok(effect(r.effects, "HIDE_RECONNECTING"));
    assert.ok(effect(r.effects, "CANCEL_RETRY"));
  });

  test("PROGRESS from recovering emits HIDE_RECONNECTING + CANCEL_RETRY", () => {
    let s = initialState();
    s = reduce(s, { type: "STALL" }).state;
    assert.equal(s.state, "recovering");
    const r = reduce(s, { type: "PROGRESS", currentTime: 10 });
    assert.equal(r.state.state, "playing");
    assert.ok(effect(r.effects, "HIDE_RECONNECTING"));
    assert.ok(effect(r.effects, "CANCEL_RETRY"));
  });

  test("PLAYING during a clean load (not recovering) does not emit CANCEL_RETRY", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    const r = reduce(s, { type: "PLAYING" });
    assert.ok(!effect(r.effects, "CANCEL_RETRY"));
    assert.ok(!effect(r.effects, "HIDE_RECONNECTING"));
  });
});

describe("stalled progress does not defeat recovery", () => {
  test("PROGRESS with unchanged currentTime while recovering stays recovering and leaves the retry armed", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 100 }).state;
    // A stall enters recovering and schedules a reload.
    const stall = reduce(s, { type: "STALL" });
    assert.equal(stall.state.state, "recovering");
    assert.ok(effect(stall.effects, "SCHEDULE_RETRY"));
    // The 1s progress poll fires with the SAME frozen currentTime because the
    // stream is genuinely stalled. This must NOT be mistaken for recovery.
    const r = reduce(stall.state, { type: "PROGRESS", currentTime: 100 });
    assert.equal(r.state.state, "recovering");
    assert.ok(!effect(r.effects, "CANCEL_RETRY"));
    assert.ok(!effect(r.effects, "HIDE_RECONNECTING"));
  });

  test("PROGRESS with advanced currentTime while recovering recovers and cancels the retry", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 100 }).state;
    const stall = reduce(s, { type: "STALL" });
    // Time genuinely advances past the saved position -> real self-recovery.
    const r = reduce(stall.state, { type: "PROGRESS", currentTime: 100.5 });
    assert.equal(r.state.state, "playing");
    assert.ok(effect(r.effects, "CANCEL_RETRY"));
    assert.ok(effect(r.effects, "HIDE_RECONNECTING"));
  });
});

describe("GONE -> fatal", () => {
  test("404 raw error goes fatal", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    const r = reduce(s, { type: "ERROR", raw: { httpStatus: 404 } });
    assert.equal(r.state.state, "fatal");
    assert.ok(effect(r.effects, "GO_FATAL"));
    assert.equal(effect(r.effects, "GO_FATAL").reason, "GONE");
  });

  // Regression: the native "black wedge" — a movie whose URL 404s goes fatal
  // correctly, but the 1s onProgress poll keeps firing PROGRESS t=0 against the
  // dead player. The PROGRESS handler used to set state:'playing' for any
  // non-recovering state, flipping fatal->playing: the "Failed to load stream"
  // panel vanished and a black "playing" frame was left instead. A background
  // poll must never resurrect a terminal state.
  test("PROGRESS from the background poll must not resurrect a fatal stream", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    s = reduce(s, { type: "ERROR", raw: { httpStatus: 404 } }).state;
    assert.equal(s.state, "fatal");
    const r = reduce(s, { type: "PROGRESS", currentTime: 0 });
    assert.equal(r.state.state, "fatal", "fatal must stay fatal under a t=0 progress poll");
  });
});

describe("bounded retry ladder -> fatal", () => {
  // A source that fails identically on every attempt and never once reaches
  // playing (a dead 404 link, an undecodable codec on the native <video> path
  // where the error carries no HTTP status) must not retry forever. After
  // MAX_LOAD_ATTEMPTS retries the machine gives up and surfaces a fatal error.
  test("repeated unrecoverable network errors go fatal after MAX_LOAD_ATTEMPTS retries", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    let fatal = null;
    for (let i = 0; i < MAX_LOAD_ATTEMPTS + 5 && !fatal; i += 1) {
      const err = reduce(s, { type: "ERROR", raw: { kind: "network" } });
      s = err.state;
      fatal = effect(err.effects, "GO_FATAL");
      if (fatal) break;
      // Host fired the scheduled retry timer.
      assert.ok(effect(err.effects, "SCHEDULE_RETRY"));
      s = reduce(s, { type: "RETRY" }).state;
    }
    assert.ok(fatal, "should eventually go fatal instead of retrying forever");
    assert.equal(fatal.reason, "UNPLAYABLE");
    assert.equal(s.state, "fatal");
  });

  test("a successful play resets the ladder so later transient errors keep retrying", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    // Burn almost the whole ladder.
    for (let i = 0; i < MAX_LOAD_ATTEMPTS - 1; i += 1) {
      s = reduce(s, { type: "ERROR", raw: { kind: "network" } }).state;
      s = reduce(s, { type: "RETRY" }).state;
    }
    // Stream comes back and makes real progress -> attemptCount resets.
    s = reduce(s, { type: "PLAYING" }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 10 }).state;
    assert.equal(s.attemptCount, 0);
    // A fresh error still schedules a retry rather than going straight to fatal.
    const err = reduce(s, { type: "ERROR", raw: { kind: "network" } });
    assert.ok(effect(err.effects, "SCHEDULE_RETRY"));
    assert.ok(!effect(err.effects, "GO_FATAL"));
  });

  test("the stall ladder is bounded too", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    let fatal = null;
    for (let i = 0; i < MAX_LOAD_ATTEMPTS + 5 && !fatal; i += 1) {
      const st = reduce(s, { type: "STALL" });
      s = st.state;
      fatal = effect(st.effects, "GO_FATAL");
      if (fatal) break;
      s = reduce(s, { type: "RETRY" }).state;
    }
    assert.ok(fatal, "an unrecoverable stall loop should go fatal");
    assert.equal(s.state, "fatal");
  });
});

describe("AUTH_EXPIRED", () => {
  test("first auth error refreshes credentials and schedules retry", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    const r = reduce(s, { type: "ERROR", raw: { httpStatus: 401 } });
    assert.equal(r.state.state, "recovering");
    assert.ok(effect(r.effects, "REFRESH_CREDENTIALS"));
    assert.ok(effect(r.effects, "SCHEDULE_RETRY"));
    assert.equal(r.state.credentialsRefreshed, true);
  });

  test("second consecutive auth error -> fatal", () => {
    let s = initialState();
    s = reduce(s, { type: "LOAD" }).state;
    s = reduce(s, { type: "ERROR", raw: { httpStatus: 403 } }).state;
    const r = reduce(s, { type: "ERROR", raw: { httpStatus: 403 } });
    assert.equal(r.state.state, "fatal");
    assert.equal(effect(r.effects, "GO_FATAL").reason, "AUTH_EXPIRED");
  });

  test("auth refresh latch clears after PLAYING", () => {
    let s = initialState();
    s = reduce(s, { type: "ERROR", raw: { httpStatus: 401 } }).state;
    assert.equal(s.credentialsRefreshed, true);
    s = reduce(s, { type: "PLAYING" }).state;
    assert.equal(s.credentialsRefreshed, false);
    // A fresh auth error now refreshes again rather than going fatal.
    const r = reduce(s, { type: "ERROR", raw: { httpStatus: 401 } });
    assert.equal(r.state.state, "recovering");
    assert.ok(effect(r.effects, "REFRESH_CREDENTIALS"));
  });
});

describe("OFFLINE / ONLINE", () => {
  test("OFFLINE enters recovering and suppresses retries", () => {
    let s = initialState({ startTime: 50 });
    s = reduce(s, { type: "PLAYING" }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 75 }).state;
    const r = reduce(s, { type: "OFFLINE" });
    assert.equal(r.state.state, "recovering");
    assert.equal(r.state.offline, true);
    assert.ok(effect(r.effects, "SHOW_RECONNECTING"));
    assert.ok(!effect(r.effects, "SCHEDULE_RETRY"));

    // RETRY while offline is a no-op (no RELOAD).
    const retry = reduce(r.state, { type: "RETRY" });
    assert.ok(!effect(retry.effects, "RELOAD"));
    assert.equal(retry.state.attemptCount, 0);
  });

  test("ONLINE after OFFLINE reloads at saved seekTo (VOD)", () => {
    let s = initialState({ isLive: false });
    s = reduce(s, { type: "PROGRESS", currentTime: 88 }).state;
    s = reduce(s, { type: "OFFLINE" }).state;
    const r = reduce(s, { type: "ONLINE" });
    const reload = effect(r.effects, "RELOAD");
    assert.ok(reload);
    assert.equal(reload.seekTo, 88);
    assert.equal(reload.toLiveEdge, false);
    assert.equal(r.state.offline, false);
  });

  test("ONLINE after OFFLINE reloads to live edge (live)", () => {
    let s = initialState({ isLive: true });
    s = reduce(s, { type: "OFFLINE" }).state;
    const r = reduce(s, { type: "ONLINE" });
    const reload = effect(r.effects, "RELOAD");
    assert.equal(reload.toLiveEdge, true);
    assert.equal(reload.seekTo, null);
  });

  test("classified OFFLINE error behaves like OFFLINE event", () => {
    let s = initialState();
    const r = reduce(s, { type: "ERROR", raw: { offline: true } });
    assert.equal(r.state.state, "recovering");
    assert.equal(r.state.offline, true);
  });
});

describe("STALL / TRANSIENT recovering + retry", () => {
  test("TRANSIENT error enters recovering and schedules retry", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    const r = reduce(s, { type: "ERROR", raw: { httpStatus: 503 } });
    assert.equal(r.state.state, "recovering");
    assert.ok(effect(r.effects, "SCHEDULE_RETRY"));
    assert.ok(effect(r.effects, "SHOW_RECONNECTING"));
  });

  test("retry delays increase and cap within the bounded ladder", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    const delays = [];

    // First error schedules retry at attemptCount=0.
    let r = reduce(s, { type: "ERROR", raw: { kind: "timeout" } });
    delays.push(effect(r.effects, "SCHEDULE_RETRY").delayMs);
    s = r.state;

    // Fire retries up to (but not past) the cap; each RETRY increments
    // attemptCount and RELOADs, and every error before the cap re-schedules.
    for (let i = 0; i < MAX_LOAD_ATTEMPTS - 1; i++) {
      r = reduce(s, { type: "RETRY" });
      assert.ok(effect(r.effects, "RELOAD"), "retry reloads");
      s = r.state;
      r = reduce(s, { type: "ERROR", raw: { kind: "timeout" } });
      delays.push(effect(r.effects, "SCHEDULE_RETRY").delayMs);
      s = r.state;
    }

    // All delays within cap (default max 15000).
    for (const d of delays) assert.ok(d <= 15000 + 1, `delay ${d} <= max`);
    assert.ok(delays[delays.length - 1] > 0);
    // One more RETRY reaches the cap, and the next error is fatal (not a retry).
    s = reduce(s, { type: "RETRY" }).state;
    const dead = reduce(s, { type: "ERROR", raw: { kind: "timeout" } });
    assert.equal(dead.state.state, "fatal");
    assert.ok(!effect(dead.effects, "SCHEDULE_RETRY"));
  });

  test("STALL while user-paused is ignored", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    s = reduce(s, { type: "USER_PAUSE" }).state;
    const r = reduce(s, { type: "STALL" });
    assert.equal(r.state.state, "playing");
    assert.equal(r.effects.length, 0);
  });
});

describe("adaptive quality downgrade", () => {
  test("K consecutive buffering episodes emit SET_QUALITY_CAP down", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;

    let setCapEffect = null;
    for (let i = 0; i < BUFFERING_DOWNGRADE_THRESHOLD; i++) {
      const r = reduce(s, { type: "STALL" });
      s = r.state;
      const e = effect(r.effects, "SET_QUALITY_CAP");
      if (e) setCapEffect = e;
    }
    assert.ok(setCapEffect, "SET_QUALITY_CAP emitted after K buffering");
    assert.equal(setCapEffect.cap, "1080"); // auto -> 1080
    assert.equal(s.qualityCap, "1080");
    assert.equal(s.bufferingStreak, 0); // reset after downgrade
  });

  test("sustained PLAYING resets attempts and steps cap back up", () => {
    let s = initialState();
    s = reduce(s, { type: "PLAYING" }).state;
    // Downgrade to 720.
    for (let i = 0; i < BUFFERING_DOWNGRADE_THRESHOLD * 2; i++) {
      s = reduce(s, { type: "STALL" }).state;
    }
    assert.equal(s.qualityCap, "720");
    // Build up some attempts.
    s = reduce(s, { type: "RETRY" }).state;
    assert.ok(s.attemptCount > 0);

    // Sustained progress while playing.
    s = reduce(s, { type: "PLAYING" }).state;
    const r = reduce(s, { type: "PROGRESS", currentTime: 200 });
    assert.equal(r.state.attemptCount, 0);
    assert.equal(r.state.bufferingStreak, 0);
    assert.equal(r.state.qualityCap, "1080"); // stepped up one rung
    assert.ok(effect(r.effects, "SET_QUALITY_CAP"));
  });

  test("downgrade never exceeds manual ceiling on step up", () => {
    let s = initialState({ qualityCap: "480", manualCap: "720" });
    s = reduce(s, { type: "PLAYING" }).state;
    // Progress steps up but cannot exceed 720.
    s = reduce(s, { type: "PLAYING" }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 1 }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 2 }).state;
    s = reduce(s, { type: "PROGRESS", currentTime: 3 }).state;
    assert.equal(s.qualityCap, "720");
  });
});

describe("RESET", () => {
  test("returns to a fresh idle state preserving isLive and manualCap", () => {
    let s = initialState({ isLive: true, startTime: 10, manualCap: "720" });
    s = reduce(s, { type: "PROGRESS", currentTime: 99 }).state;
    s = reduce(s, { type: "ERROR", raw: { httpStatus: 404 } }).state;
    assert.equal(s.state, "fatal");
    const r = reduce(s, { type: "RESET" });
    assert.equal(r.state.state, "idle");
    assert.equal(r.state.isLive, true);
    assert.equal(r.state.manualCap, "720");
    assert.equal(r.state.attemptCount, 0);
  });
});
