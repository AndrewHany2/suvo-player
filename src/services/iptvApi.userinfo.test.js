import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { IPTVApi } from "./iptvApi.js";

// getUserInfo is the cheap credential/auth check: player_api.php with NO action
// returns { user_info, server_info } (a few hundred bytes) instead of the whole
// live-stream catalog. Xtream authenticates on the actionless endpoint.
describe("IPTVApi.getUserInfo", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test("hits player_api.php with NO action and returns the user_info envelope", async () => {
    let calledUrl;
    globalThis.fetch = async (url) => {
      calledUrl = url;
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ user_info: { auth: 1, status: "Active" }, server_info: {} }),
      };
    };
    const api = new IPTVApi();
    api.baseUrl = "http://host:8080"; api.username = "u"; api.password = "p";

    const info = await api.getUserInfo();
    assert.equal(info.user_info.auth, 1);

    const u = new URL(calledUrl);
    assert.equal(u.pathname, "/player_api.php");
    assert.equal(u.searchParams.get("username"), "u");
    assert.equal(u.searchParams.get("password"), "p");
    assert.equal(u.searchParams.has("action"), false, "the auth check sends no action param");
  });

  test("is not cached — a second call re-hits the network (auth state can change)", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ user_info: { auth: 1 } }) };
    };
    const api = new IPTVApi();
    api.baseUrl = "http://host"; api.username = "u"; api.password = "p";
    await api.getUserInfo();
    await api.getUserInfo();
    assert.equal(calls, 2);
  });
});
