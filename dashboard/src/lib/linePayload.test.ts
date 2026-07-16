import { describe, test, expect } from "vitest";
import { buildLinePayload, lineUpdateBlockedReason } from "./linePayload";

describe("buildLinePayload", () => {
  test("xtream: trims host/username, keeps password as-is, nulls out url", () => {
    const line = buildLinePayload("xtream", {
      host: " example.com ",
      lineUsername: " bob ",
      linePassword: "s3cret",
      url: "",
      nickname: "",
    });
    expect(line).toEqual({
      type: "xtream",
      host: "example.com",
      username: "bob",
      password: "s3cret",
      url: null,
      nickname: null,
    });
  });

  test("m3u: trims url, nulls out host/username/password", () => {
    const line = buildLinePayload("m3u", {
      host: "unused",
      lineUsername: "unused",
      linePassword: "unused",
      url: " https://example.com/playlist.m3u ",
      nickname: "Main line",
    });
    expect(line).toEqual({
      type: "m3u",
      host: null,
      username: null,
      password: null,
      url: "https://example.com/playlist.m3u",
      nickname: "Main line",
    });
  });

  test("blank nickname becomes null, not an empty string", () => {
    const line = buildLinePayload("xtream", {
      host: "h",
      lineUsername: "u",
      linePassword: "p",
      url: "",
      nickname: "   ",
    });
    expect(line.nickname).toBeNull();
  });
});

describe("lineUpdateBlockedReason", () => {
  test("xtream with blank password is blocked", () => {
    expect(lineUpdateBlockedReason("xtream", "")).toMatch(/re-enter the password/i);
    expect(lineUpdateBlockedReason("xtream", "   ")).toMatch(/re-enter the password/i);
  });
  test("xtream with a password is allowed", () => {
    expect(lineUpdateBlockedReason("xtream", "s3cret")).toBeNull();
  });
  test("m3u is never blocked by password, blank or not", () => {
    expect(lineUpdateBlockedReason("m3u", "")).toBeNull();
    expect(lineUpdateBlockedReason("m3u", "anything")).toBeNull();
  });
});
