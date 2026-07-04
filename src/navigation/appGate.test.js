import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveGate } from "./appGate.js";

// A fully-booted, signed-in, device-ok, profile-selected state → the main app.
const APP = {
  supabaseConfigured: true,
  authLoading: false,
  authUser: { id: "u1" },
  deviceStatus: "ok",
  activeProfileId: "p1",
};

describe("resolveGate precedence", () => {
  test("missing Supabase config short-circuits everything else", () => {
    assert.equal(
      resolveGate({ ...APP, supabaseConfigured: false, authLoading: true, authUser: null }),
      "config-error",
    );
  });

  test("authLoading shows the loading splash (config present)", () => {
    assert.equal(resolveGate({ ...APP, authLoading: true, authUser: null }), "loading");
  });

  test("signed out (config present, not loading) shows auth", () => {
    assert.equal(resolveGate({ ...APP, authUser: null }), "auth");
  });

  test("device claim pending shows the loading splash", () => {
    assert.equal(resolveGate({ ...APP, deviceStatus: "pending" }), "loading");
  });

  test("device claim denied shows the device-locked screen", () => {
    assert.equal(resolveGate({ ...APP, deviceStatus: "denied" }), "device-locked");
  });

  test("no active profile (device ok) shows the profile picker", () => {
    assert.equal(resolveGate({ ...APP, activeProfileId: null }), "profiles");
  });

  test("fully booted state shows the main app", () => {
    assert.equal(resolveGate(APP), "app");
  });
});

describe("resolveGate boot-flow scenarios", () => {
  test("fresh login: loading → auth → loading(device) → profiles → app", () => {
    // 1. Session still resolving.
    assert.equal(
      resolveGate({ supabaseConfigured: true, authLoading: true, authUser: null, deviceStatus: "pending", activeProfileId: null }),
      "loading",
    );
    // 2. Resolved, signed out.
    assert.equal(
      resolveGate({ supabaseConfigured: true, authLoading: false, authUser: null, deviceStatus: "pending", activeProfileId: null }),
      "auth",
    );
    // 3. Signed in, device claim in flight.
    assert.equal(
      resolveGate({ supabaseConfigured: true, authLoading: false, authUser: { id: "u1" }, deviceStatus: "pending", activeProfileId: null }),
      "loading",
    );
    // 4. Device ok, no profile chosen yet.
    assert.equal(
      resolveGate({ supabaseConfigured: true, authLoading: false, authUser: { id: "u1" }, deviceStatus: "ok", activeProfileId: null }),
      "profiles",
    );
    // 5. Profile chosen → app.
    assert.equal(
      resolveGate({ supabaseConfigured: true, authLoading: false, authUser: { id: "u1" }, deviceStatus: "ok", activeProfileId: "p1" }),
      "app",
    );
  });

  test("device-locked account never reaches profiles or app", () => {
    assert.equal(
      resolveGate({ supabaseConfigured: true, authLoading: false, authUser: { id: "u1" }, deviceStatus: "denied", activeProfileId: "p1" }),
      "device-locked",
    );
  });

  test("auth takes precedence over a pending device status", () => {
    // Signed out but deviceStatus somehow non-ok: auth wins (authUser gate first).
    assert.equal(
      resolveGate({ supabaseConfigured: true, authLoading: false, authUser: null, deviceStatus: "denied", activeProfileId: null }),
      "auth",
    );
  });

  test("defensive: empty/undefined state resolves to config-error", () => {
    assert.equal(resolveGate(), "config-error");
    assert.equal(resolveGate({}), "config-error");
  });
});
