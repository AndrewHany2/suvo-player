import { parseRating } from "./parse";

export function normalizeMovie(raw) {
  return {
    // Spread raw so existing code reading stream_id, stream_icon, etc. still works
    ...raw,
    // Normalized aliases
    id: raw.stream_id ?? raw.streamId,
    poster: raw.stream_icon || raw.cover || raw.movie_image || null,
    containerExtension: raw.container_extension || "mp4",
    rating: parseRating(raw.tmdb_rating ?? raw.rating),
    categoryId: raw.category_id ? String(raw.category_id) : null,
  };
}
