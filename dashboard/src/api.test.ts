import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// api.ts imports ./supabase, whose module-level createClient() call eagerly
// constructs a realtime client requiring a global WebSocket — unavailable
// under plain Node 20 (no --experimental-websocket). Mock it out so this
// suite can exercise call()/apiErrorMessage in isolation. `mockState` is
// hoisted (vi.mock factories run before imports) so tests can toggle the
// current session between the token/no-token paths.
const mockState = vi.hoisted(() => ({
  session: null as null | { access_token: string },
}));
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockState.session } }),
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => {},
    },
  },
}));

import { apiErrorMessage, call } from "./api";

describe("apiErrorMessage", () => {
  test("maps known codes to friendly copy", () => {
    expect(apiErrorMessage("QUOTA_EXCEEDED")).toMatch(/quota/i);
    expect(apiErrorMessage("PROVIDER_HAS_ACCOUNTS")).toMatch(/accounts/i);
    expect(apiErrorMessage("FORBIDDEN")).toMatch(/permission/i);
  });
  test("maps SERVER_ERROR to friendly copy", () => {
    // The admin function returns SERVER_ERROR on unexpected failures — must
    // never surface the raw code to a reseller.
    expect(apiErrorMessage("SERVER_ERROR")).not.toBe("SERVER_ERROR");
    expect(apiErrorMessage("SERVER_ERROR")).toMatch(/went wrong/i);
  });
  test("falls back to the raw code when unknown", () => {
    expect(apiErrorMessage("WAT")).toBe("WAT");
  });
});

describe("call", () => {
  beforeEach(() => {
    mockState.session = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("throws Unauthorized when there is no session token", async () => {
    mockState.session = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(call("providers.list")).rejects.toThrow("Unauthorized");
    // Must not even attempt the request without a token.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns the parsed body on a 2xx response", async () => {
    mockState.session = { access_token: "tok-123" };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, rows: [1, 2, 3] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await call("providers.list", { limit: 10 });
    expect(result).toEqual({ ok: true, rows: [1, 2, 3] });

    // Sanity-check the request wiring: single POST carrying the Bearer token
    // and the { action, payload } envelope.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      action: "providers.list",
      payload: { limit: 10 },
    });
  });

  test("throws with the error code and preserves `fields` on validation failure", async () => {
    mockState.session = { access_token: "tok-123" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "INVALID_INPUT", fields: ["username"] }),
      })),
    );

    const err = await call("accounts.create", {}).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("INVALID_INPUT");
    expect((err as any).fields).toEqual(["username"]);
  });

  test("falls back to HTTP_<status> when the error body has no code", async () => {
    mockState.session = { access_token: "tok-123" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );

    await expect(call("providers.list")).rejects.toThrow("HTTP_503");
  });
});
