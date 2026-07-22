---
target: tv and native (post-fix re-critique)
total_score: 29
p0_count: 0
p1_count: 0
timestamp: 2026-07-22T09-07-41Z
slug: all-platforms-tv
---
# Cross-Platform Consistency Re-Critique — TV (post-fix)

Method: dual-agent (A: a71fa556 · B: a6cca2df). Lens: cross-platform parity vs web reference.

## Design Health — 29/40 (Good) — up from 25/40
Consistency #4: 1 → 3. Only Help/docs (#10) below 3.
Heuristics: 1:3 2:3 3:3 4:3 5:3 6:3 7:3 8:3 9:3 10:2

## Verified fixes (Assessment B confirmed all in source)
- Topbar "Home" (was "My List & History") on both empty + populated renders.
- Interactive Home hero live via VirtualShelvesTV renderHero + featuredItem + onHeroPlay/onHeroDetails; copy matches web string-for-string.
- Dead see-all chevron gated on onSeeAll — gone on Home.
- Frozen LABELS consumed by TV shelves; ContinueCardTV text bumped ss16/14 textDim.
- webOS-safety holds: hero uses explicit top/left/right/bottom (no inset shorthand), no box-shadow/transition/var; detector 0 errors, fix-owned CSS clean.

## Remaining issues
- **[P2] Home load orientation** — the hero renders at height:100% (taller than the Movies/Series ss(900) billboard), so on first paint the focus ring sits on the first My-List poster below the fold: no visible cursor, and Enter fires the first My-List item instead of the visibly-featured title. Fix: initialize the top focus zone to "hero" when the hero is interactive (preferred), OR cap the Home hero height to HERO_H so the first shelf peeks.
- [P3] Resume-verb drift: "Resume" (hero) vs "Continue"/"Continue S..E.." (detail) vs "Continue Watching" (shelf). Freeze one verb in LABELS.
- [P3] Hero "Resume" opens the detail screen rather than starting playback. Note: the web hero does the SAME (openDetail(featured)), so this is consistent cross-platform — a shared UX quirk, not a divergence.

## Persona
- Alex (remote): no visible focus ring on Home load; hero interactivity only discoverable by pressing Up.
- 10-foot viewer: bumped card text reads well; load-orientation gap is the main flag.
