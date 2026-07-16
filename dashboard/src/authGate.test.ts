import { describe, test, expect } from "vitest";
import { shouldRejectSession, isAllowedRole } from "./authGate";

describe("shouldRejectSession", () => {
  test("FORBIDDEN → reject (tear down session, show gate message)", () => {
    expect(shouldRejectSession("FORBIDDEN")).toBe(true);
  });
  test("Unauthorized → reject", () => {
    expect(shouldRejectSession("Unauthorized")).toBe(true);
  });
  test("SERVER_ERROR → retry, NOT reject (keep session)", () => {
    expect(shouldRejectSession("SERVER_ERROR")).toBe(false);
  });
  test("HTTP_500 → retry, NOT reject", () => {
    expect(shouldRejectSession("HTTP_500")).toBe(false);
  });
});

describe("isAllowedRole", () => {
  test("provider → allowed", () => {
    expect(isAllowedRole("provider")).toBe(true);
  });
  test("super_admin → allowed", () => {
    expect(isAllowedRole("super_admin")).toBe(true);
  });
  test("customer → rejected", () => {
    expect(isAllowedRole("customer")).toBe(false);
  });
  test("empty role → rejected", () => {
    expect(isAllowedRole("")).toBe(false);
  });
});
