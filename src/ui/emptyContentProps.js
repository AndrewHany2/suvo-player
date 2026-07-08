// Empty-state copy for the Movies/Series browse screens, shared by all platform
// variants so the wording stays in one place. Shown whenever a browse tab
// finished loading with zero shelves — for any account type.

/**
 * StatePanel props ({ icon, title, message }) for an empty Movies or Series tab.
 * @param {"movies"|"series"} kind
 */
export function emptyContentProps(kind) {
  return kind === "series"
    ? { icon: "tv", title: "No series found", message: "We couldn't find any series for this account." }
    : { icon: "film", title: "No movies found" };
}
