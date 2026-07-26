import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  KEY_LEFT, KEY_UP, KEY_RIGHT, KEY_DOWN, KEY_ENTER, KEY_BACK,
  KEY_CODES, resolveAction, isBackKey, isMacCommand,
} from "./keys.js";

describe("TV key constants", () => {
  test("directional + enter codes are the standard DOM keyCodes", () => {
    assert.equal(KEY_LEFT, 37);
    assert.equal(KEY_UP, 38);
    assert.equal(KEY_RIGHT, 39);
    assert.equal(KEY_DOWN, 40);
    assert.equal(KEY_ENTER, 13);
  });

  test("KEY_BACK covers every remote/back variant we support", () => {
    // Esc, Backspace, LG webOS, Samsung Tizen, Meta. Dropping any of these
    // silently breaks the Back button on that hardware — this test is the guard.
    for (const code of [27, 8, 461, 10009, 91]) {
      assert.ok(KEY_BACK.has(code), `KEY_BACK must include ${code}`);
    }
  });
});

describe("KEY_CODES is derived from the constants (no drift)", () => {
  test("directional + enter map to their logical actions", () => {
    assert.equal(KEY_CODES[KEY_LEFT], "left");
    assert.equal(KEY_CODES[KEY_UP], "up");
    assert.equal(KEY_CODES[KEY_RIGHT], "right");
    assert.equal(KEY_CODES[KEY_DOWN], "down");
    assert.equal(KEY_CODES[KEY_ENTER], "enter");
  });

  test("every KEY_BACK code maps to \"back\"", () => {
    for (const code of KEY_BACK) assert.equal(KEY_CODES[code], "back");
  });
});

describe("resolveAction", () => {
  test("maps key names and key codes to logical actions", () => {
    assert.equal(resolveAction({ key: "ArrowLeft" }), "left");
    assert.equal(resolveAction({ keyCode: KEY_ENTER }), "enter");
    assert.equal(resolveAction({ keyCode: 10009 }), "back");
    assert.equal(resolveAction({ key: "Escape" }), "back");
  });

  test("returns null for unmapped keys", () => {
    assert.equal(resolveAction({ key: "z" }), null);
    assert.equal(resolveAction({ keyCode: 999 }), null);
  });

  test("ignores the Mac ⌘ modifier (shares keyCode 91 with Back)", () => {
    assert.equal(
      resolveAction({ key: "Meta", code: "MetaLeft", keyCode: 91 }),
      null,
    );
  });
});

describe("isBackKey / isMacCommand", () => {
  test("isBackKey recognises every back variant, not enter", () => {
    assert.equal(isBackKey({ keyCode: 461 }), true);
    assert.equal(isBackKey({ key: "Escape" }), true);
    assert.equal(isBackKey({ keyCode: KEY_ENTER }), false);
  });

  test("isMacCommand only matches MetaLeft/MetaRight codes", () => {
    assert.equal(isMacCommand({ code: "MetaLeft" }), true);
    assert.equal(isMacCommand({ code: "MetaRight" }), true);
    assert.equal(isMacCommand({ code: "KeyA" }), false);
    assert.equal(isMacCommand({ keyCode: 91 }), false);
  });
});
