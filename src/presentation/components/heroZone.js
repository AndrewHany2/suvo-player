/**
 * Pure D-pad reducer for the two focus zones ABOVE the shelf list in
 * VirtualShelves.tv: the Hero billboard (Play/Details) and the Discover pills.
 *
 * The shelves zone itself is handled by the component's existing focus math;
 * this module owns only the hero/pills zones and their boundaries with the
 * shelves (below) and the navbar (above). Layout order top→bottom is
 * Hero → Pills → Shelves, so "up" climbs Shelves→Pills→Hero→navbar.
 *
 * State : { zone: 'hero'|'pills'|'shelves', heroBtn: 0|1, pillCol: number }
 * cfg   : { hasHero: boolean, hasPills: boolean, pillCount: number }
 *
 * No React, no DOM — unit-tested with node --test.
 */

const HERO_BTN_COUNT = 2; // Play (0), Details (1)

function clampPill(col, cfg) {
  const max = Math.max(0, cfg.pillCount - 1);
  return Math.min(Math.max(0, col), max);
}

// Zone directly above the shelves (entered by pressing Up on the top shelf).
// Pills sit nearest the shelves; hero is above the pills.
function zoneAboveShelves(cfg) {
  if (cfg.hasPills) return "pills";
  if (cfg.hasHero) return "hero";
  return null; // nothing above → caller yields to the navbar
}

// Named alias for the shelves→top-zone call site.
function enterTopFromShelves(cfg) {
  return zoneAboveShelves(cfg);
}

// Move within/between the top zones. Returns { state, action } where action is
// null (handled here), "toShelves" (focus the first shelf), or "toNavbar"
// (yield focus upward to the nav bar).
function zoneMove(state, dir, cfg) {
  const s = state;
  if (s.zone === "hero") {
    switch (dir) {
      case "left":
        return { state: { ...s, heroBtn: Math.max(0, s.heroBtn - 1) }, action: null };
      case "right":
        return { state: { ...s, heroBtn: Math.min(HERO_BTN_COUNT - 1, s.heroBtn + 1) }, action: null };
      case "up":
        return { state: s, action: "toNavbar" };
      case "down":
        if (cfg.hasPills)
          return { state: { ...s, zone: "pills", pillCol: clampPill(s.pillCol, cfg) }, action: null };
        return { state: s, action: "toShelves" };
      default:
        return { state: s, action: null };
    }
  }
  if (s.zone === "pills") {
    switch (dir) {
      case "left":
        return { state: { ...s, pillCol: Math.max(0, s.pillCol - 1) }, action: null };
      case "right":
        return { state: { ...s, pillCol: clampPill(s.pillCol + 1, cfg) }, action: null };
      case "up":
        if (cfg.hasHero) return { state: { ...s, zone: "hero" }, action: null };
        return { state: s, action: "toNavbar" };
      case "down":
        return { state: s, action: "toShelves" };
      default:
        return { state: s, action: null };
    }
  }
  return { state: s, action: null }; // 'shelves' not owned here
}

// What Enter activates in the current top zone.
function zoneActivate(state) {
  if (state.zone === "hero") return state.heroBtn === 0 ? "play" : "details";
  if (state.zone === "pills") return "pill";
  return null;
}

export {
  HERO_BTN_COUNT,
  zoneAboveShelves,
  enterTopFromShelves,
  zoneMove,
  zoneActivate,
};
