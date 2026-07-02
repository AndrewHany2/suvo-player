import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERO_BTN_COUNT,
  zoneAboveShelves,
  enterTopFromShelves,
  zoneMove,
  zoneActivate,
} from "./heroZone.js";

const cfgBoth = { hasHero: true, hasPills: true, pillCount: 2 };
const cfgHeroOnly = { hasHero: true, hasPills: false, pillCount: 0 };
const cfgPillsOnly = { hasHero: false, hasPills: true, pillCount: 3 };
const cfgNone = { hasHero: false, hasPills: false, pillCount: 0 };

test("HERO_BTN_COUNT is 2 (Play, Details)", () => {
  assert.equal(HERO_BTN_COUNT, 2);
});

test("zoneAboveShelves prefers pills, then hero, else null", () => {
  assert.equal(zoneAboveShelves(cfgBoth), "pills");
  assert.equal(zoneAboveShelves(cfgHeroOnly), "hero");
  assert.equal(zoneAboveShelves(cfgPillsOnly), "pills");
  assert.equal(zoneAboveShelves(cfgNone), null);
  assert.equal(enterTopFromShelves(cfgBoth), "pills");
});

test("hero: left/right clamp across the two buttons", () => {
  const play = { zone: "hero", heroBtn: 0, pillCol: 0 };
  assert.deepEqual(zoneMove(play, "left", cfgBoth), { state: play, action: null });
  assert.deepEqual(zoneMove(play, "right", cfgBoth), {
    state: { zone: "hero", heroBtn: 1, pillCol: 0 },
    action: null,
  });
  const details = { zone: "hero", heroBtn: 1, pillCol: 0 };
  assert.deepEqual(zoneMove(details, "right", cfgBoth), { state: details, action: null });
  assert.deepEqual(zoneMove(details, "left", cfgBoth), {
    state: { zone: "hero", heroBtn: 0, pillCol: 0 },
    action: null,
  });
});

test("hero up yields to navbar", () => {
  const s = { zone: "hero", heroBtn: 0, pillCol: 0 };
  assert.deepEqual(zoneMove(s, "up", cfgBoth), { state: s, action: "toNavbar" });
});

test("hero down goes to pills when present, else to shelves", () => {
  const s = { zone: "hero", heroBtn: 1, pillCol: 1 };
  assert.deepEqual(zoneMove(s, "down", cfgBoth), {
    state: { zone: "pills", heroBtn: 1, pillCol: 1 },
    action: null,
  });
  assert.deepEqual(zoneMove(s, "down", cfgHeroOnly), { state: s, action: "toShelves" });
});

test("pills: left/right clamp across pillCount", () => {
  const s = { zone: "pills", heroBtn: 0, pillCol: 0 };
  assert.deepEqual(zoneMove(s, "left", cfgPillsOnly), { state: s, action: null });
  assert.deepEqual(zoneMove(s, "right", cfgPillsOnly), {
    state: { zone: "pills", heroBtn: 0, pillCol: 1 },
    action: null,
  });
  const last = { zone: "pills", heroBtn: 0, pillCol: 2 };
  assert.deepEqual(zoneMove(last, "right", cfgPillsOnly), { state: last, action: null });
});

test("pills up goes to hero when present, else navbar", () => {
  const s = { zone: "pills", heroBtn: 0, pillCol: 1 };
  assert.deepEqual(zoneMove(s, "up", cfgBoth), {
    state: { zone: "hero", heroBtn: 0, pillCol: 1 },
    action: null,
  });
  assert.deepEqual(zoneMove(s, "up", cfgPillsOnly), { state: s, action: "toNavbar" });
});

test("pills down goes to shelves", () => {
  const s = { zone: "pills", heroBtn: 0, pillCol: 1 };
  assert.deepEqual(zoneMove(s, "down", cfgBoth), { state: s, action: "toShelves" });
});

test("entering pills from hero clamps a stale pillCol into range", () => {
  const s = { zone: "hero", heroBtn: 0, pillCol: 9 };
  assert.deepEqual(zoneMove(s, "down", cfgBoth), {
    state: { zone: "pills", heroBtn: 0, pillCol: 1 },
    action: null,
  });
});

test("zoneActivate maps zone+button to a handler key", () => {
  assert.equal(zoneActivate({ zone: "hero", heroBtn: 0, pillCol: 0 }), "play");
  assert.equal(zoneActivate({ zone: "hero", heroBtn: 1, pillCol: 0 }), "details");
  assert.equal(zoneActivate({ zone: "pills", heroBtn: 0, pillCol: 0 }), "pill");
  assert.equal(zoneActivate({ zone: "shelves", heroBtn: 0, pillCol: 0 }), null);
});
