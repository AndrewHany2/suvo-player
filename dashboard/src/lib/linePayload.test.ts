import { describe, test, expect } from "vitest";
import { buildLinePayload, lineUpdateBlockedReason, buildLinesPayload, isEmptyLineForm, type LineForm } from "./linePayload";

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

  test("xtream: nulls out a non-empty url so a stray M3U url can't leak through", () => {
    const line = buildLinePayload("xtream", {
      host: "example.com",
      lineUsername: "bob",
      linePassword: "s3cret",
      url: "https://example.com/leftover.m3u",
      nickname: "",
    });
    expect(line.url).toBeNull();
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

describe("buildLinesPayload", () => {
  test("maps each form to its payload", () => {
    const forms: LineForm[] = [
      { type: "xtream", host: "h:8080", lineUsername: "u", linePassword: "p", url: "", nickname: "A" },
      { type: "m3u", host: "", lineUsername: "", linePassword: "", url: "http://x/get.php", nickname: "" },
    ];
    const out = buildLinesPayload(forms);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "xtream", host: "h:8080", username: "u", password: "p", nickname: "A" });
    expect(out[1]).toMatchObject({ type: "m3u", url: "http://x/get.php", host: null });
  });

  test("returns an empty array for no forms", () => {
    expect(buildLinesPayload([])).toEqual([]);
  });
});

describe("isEmptyLineForm", () => {
  const form = (patch: Partial<LineForm>): LineForm => ({
    type: "xtream", host: "", lineUsername: "", linePassword: "", url: "", nickname: "", ...patch,
  });

  test("xtream with all credential fields blank is empty (even with a nickname)", () => {
    expect(isEmptyLineForm(form({ type: "xtream", nickname: "My line" }))).toBe(true);
    expect(isEmptyLineForm(form({ type: "xtream", host: "   ", lineUsername: " ", linePassword: "  " }))).toBe(true);
  });

  test("xtream with any credential field filled is not empty", () => {
    expect(isEmptyLineForm(form({ type: "xtream", host: "h" }))).toBe(false);
    expect(isEmptyLineForm(form({ type: "xtream", lineUsername: "u" }))).toBe(false);
    expect(isEmptyLineForm(form({ type: "xtream", linePassword: "p" }))).toBe(false);
  });

  test("m3u with a blank url is empty", () => {
    expect(isEmptyLineForm(form({ type: "m3u", url: "   " }))).toBe(true);
  });

  test("m3u with a url is not empty", () => {
    expect(isEmptyLineForm(form({ type: "m3u", url: "http://x/get.php" }))).toBe(false);
  });
});
