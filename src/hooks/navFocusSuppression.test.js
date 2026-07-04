import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shouldSuppressKey } from "./navFocusSuppression.js";

describe("shouldSuppressKey", () => {
  test("suppresses only when yielding AND nav has focus", () => {
    assert.equal(shouldSuppressKey(true, true), true);
    assert.equal(shouldSuppressKey(false, true), false);
    assert.equal(shouldSuppressKey(true, false), false);
    assert.equal(shouldSuppressKey(false, false), false);
  });

  test("coerces truthy/falsy inputs to booleans", () => {
    assert.equal(shouldSuppressKey(1, 1), true);
    assert.equal(shouldSuppressKey(0, 1), false);
    assert.equal(shouldSuppressKey(undefined, undefined), false);
  });
});

// Regression harness for the ACTUAL bug: the nav-focus flag must survive handler
// re-registration. This models the fixed hook — a flag read from a shared store
// (not captured in the register() closure) at key-dispatch time — and proves that
// re-registering the handlers while nav-focus is held keeps keys suppressed.
describe("nav-focus survives handler re-registration", () => {
  // Minimal stand-in for the fixed useTVInput wiring: a shared flag + a
  // dispatcher that reads it through shouldSuppressKey each keypress.
  function makeInput() {
    const store = { navHasFocus: false };
    let handlers = null;
    let yieldToNav = false;
    return {
      setNavFocus: (v) => { store.navHasFocus = v; },
      register: (h, opts = {}) => {
        handlers = h;
        yieldToNav = !!opts.yieldToNav;
      },
      // Simulate a keydown: honor suppression, else invoke the handler.
      press: (action) => {
        if (shouldSuppressKey(store.navHasFocus, yieldToNav)) return false;
        handlers?.[action]?.();
        return true;
      },
    };
  }

  test("keys stay suppressed after re-register while nav-focus is held", () => {
    const input = makeInput();
    let calls = 0;
    const handlers = { right: () => { calls += 1; } };

    input.register(handlers, { yieldToNav: true });
    input.setNavFocus(true); // navbar takes the remote

    // Re-register (what VirtualShelves does on nearly every render). With the old
    // closure-scoped flag this reset suppression to false; now it must not.
    input.register(handlers, { yieldToNav: true });
    assert.equal(input.press("right"), false, "should be suppressed after re-register");

    input.register(handlers, { yieldToNav: true });
    input.register(handlers, { yieldToNav: true });
    assert.equal(input.press("right"), false, "still suppressed after repeated re-register");
    assert.equal(calls, 0);

    // Navbar hands focus back → keys act again.
    input.setNavFocus(false);
    assert.equal(input.press("right"), true);
    assert.equal(calls, 1);
  });

  test("without yieldToNav, nav-focus never suppresses", () => {
    const input = makeInput();
    let calls = 0;
    input.register({ enter: () => { calls += 1; } }, { yieldToNav: false });
    input.setNavFocus(true);
    assert.equal(input.press("enter"), true);
    assert.equal(calls, 1);
  });
});
