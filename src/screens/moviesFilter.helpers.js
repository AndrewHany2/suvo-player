// Pure Movies-screen filtering helpers, split out of MoviesScreen so the
// category rail and grid filters can be unit-tested under plain `node --test`
// without loading React/RN modules. Mirrors the useLiveTV.helpers.js pattern.

import { normalizeSearch } from "../utils/normalizeSearch.js";

/**
 * Build the category rail list: an "All Movies" entry followed by the provider
 * categories, narrowed to those whose name matches `query` (case-insensitive).
 * While categories are still loading (empty/nullish) the raw value is returned
 * unchanged so callers can distinguish "loading" from "no matches".
 */
export function buildCategoryFilter(categories, query) {
  if (!categories?.length) return categories ?? [];
  const q = normalizeSearch(query);
  const matches = q
    ? categories.filter((c) => normalizeSearch(c.name).includes(q))
    : categories;
  return [{ id: "all", name: "All Movies" }, ...matches];
}

/**
 * Narrow a movie list by the active alpha filter and grid search query, both
 * case-insensitive and composable. `letter` "all" (or falsy) disables the alpha
 * filter; an empty `query` disables text search. A null/undefined list yields [].
 */
export function filterMovies(items, letter, query) {
  if (!items) return [];
  let out = items;
  if (letter && letter !== "all") {
    out = out.filter((m) => m.name?.toLowerCase().startsWith(letter));
  }
  const q = normalizeSearch(query);
  if (q) {
    out = out.filter((m) => normalizeSearch(m.name).includes(q));
  }
  return out;
}
