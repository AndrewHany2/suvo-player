import { parseRating } from "./parse";

export function normalizeSeries(raw) {
  return {
    ...raw,
    id: raw.series_id ?? raw.seriesId,
    poster: raw.cover || raw.backdrop_path || null,
    rating: parseRating(raw.rating),
    plot: raw.plot || null,
    genre: raw.genre ? raw.genre.split(",")[0].trim() : null,
    releaseDate: raw.releaseDate || raw.release_date || null,
    categoryId: raw.category_id ? String(raw.category_id) : null,
  };
}
