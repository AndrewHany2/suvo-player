const test = require("node:test");
const assert = require("node:assert/strict");
const { INITIAL_TV_NAV, tvNavReduce } = require("./tvSettingsNav.js");

const ctx = (o = {}) => ({ iconCount: 6, menuLen: 4, initialMenuIndex: 0, ...o });

test("INITIAL_TV_NAV is not-in-row", () => {
  assert.deepEqual(INITIAL_TV_NAV, { focus: -1, inMenu: false, menuIndex: 0 });
});

test("right moves focus and clamps at last icon", () => {
  let s = { focus: 0, inMenu: false, menuIndex: 0 };
  s = tvNavReduce(s, "right", ctx({ iconCount: 3 })).state;
  assert.equal(s.focus, 1);
  s = tvNavReduce({ focus: 2, inMenu: false, menuIndex: 0 }, "right", ctx({ iconCount: 3 })).state;
  assert.equal(s.focus, 2); // clamped
});

test("left moves focus and clamps at 0", () => {
  const s = tvNavReduce({ focus: 0, inMenu: false, menuIndex: 0 }, "left", ctx()).state;
  assert.equal(s.focus, 0);
});

test("down and back leave the row when no menu open", () => {
  assert.equal(tvNavReduce({ focus: 2, inMenu: false, menuIndex: 0 }, "down", ctx()).state.focus, -1);
  assert.equal(tvNavReduce({ focus: 2, inMenu: false, menuIndex: 0 }, "back", ctx()).state.focus, -1);
});

test("ok in row opens the menu at the initial selection index", () => {
  const { state, effect } = tvNavReduce({ focus: 1, inMenu: false, menuIndex: 0 }, "ok", ctx({ initialMenuIndex: 2 }));
  assert.equal(state.inMenu, true);
  assert.equal(state.menuIndex, 2);
  assert.equal(state.focus, 1);
  assert.equal(effect, null);
});

test("up/down move the menu index and clamp", () => {
  let s = { focus: 1, inMenu: true, menuIndex: 0 };
  s = tvNavReduce(s, "down", ctx({ menuLen: 3 })).state;
  assert.equal(s.menuIndex, 1);
  s = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 0 }, "up", ctx({ menuLen: 3 })).state;
  assert.equal(s.menuIndex, 0); // clamped
  s = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 2 }, "down", ctx({ menuLen: 3 })).state;
  assert.equal(s.menuIndex, 2); // clamped at menuLen-1
});

test("ok in menu emits apply with the current index and closes the menu", () => {
  const { state, effect } = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 2 }, "ok", ctx());
  assert.deepEqual(effect, { type: "apply", index: 2 });
  assert.equal(state.inMenu, false);
  assert.equal(state.focus, 1); // focus retained
});

test("back in menu closes the menu without applying, keeping focus", () => {
  const { state, effect } = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 2 }, "back", ctx());
  assert.equal(effect, null);
  assert.equal(state.inMenu, false);
  assert.equal(state.focus, 1);
});

test("left/right are no-ops inside an open menu", () => {
  const s = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 1 }, "right", ctx()).state;
  assert.deepEqual(s, { focus: 1, inMenu: true, menuIndex: 1 });
});
