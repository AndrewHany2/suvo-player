/**
 * Shared user-facing copy for the "saved list" / "keep watching" concepts.
 *
 * These strings used to be inlined at every call site, which let them drift per
 * platform: the same collection read "Favorites"/"Saved" on native, "My List"
 * on web/TV, and "Favorites" again on the TV Home shelf; the resume list was
 * "Watch History" (native) vs "Continue Watching" (web/TV); the folded Home
 * screen was "Home" (web nav) vs "My List & History" (TV). One catalog, one
 * vocabulary, rendered identically on iOS/Android/web/Electron/TV.
 *
 * Canonical vocabulary = the web reference. Frozen so a stray reassignment
 * can't reintroduce drift.
 */
export const LABELS = Object.freeze({
  // The saved-items collection.
  myList: "My List",
  inMyList: "In My List",
  addToMyList: "Add to My List",
  removeFromMyList: "Remove from My List",

  // The resume / progress list.
  continueWatching: "Continue Watching",

  // The folded Home/History landing surface.
  home: "Home",

  // Empty state (nothing saved / watched yet).
  emptyTitle: "Your Home is ready",
  emptyBody:
    "Play a movie, series, or channel and it appears here — and follows you to every device on your account. Browse Movies or Series to get started.",
  emptyCta: "Browse Movies",

  // No IPTV account connected. One title/body/CTA for every surface (Movies,
  // Series, LiveTV, History) so the no-account empty state can't drift again —
  // and the CTA points at the Accounts dialog, the only place accounts are added.
  noAccountTitle: "No account connected",
  noAccountBody:
    "Connect an IPTV account to save your list and keep watching across devices.",
  noAccountCta: "Connect account",

  // Shared retry affordance (StatePanel error mode + any inline retry).
  retry: "Retry",
});

export default LABELS;
