import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// These tests exercise the REAL shipped normalizers, not inline copies, so a
// regression in src/domain/models/* actually turns a test red.
//
// Category.js and Channel.js have no internal imports and load under node:test
// directly. Movie.js and Series.js do `import { parseRating } from "./parse"`
// (extensionless — metro/expo resolve it, Node's native ESM resolver does not).
// We register a tiny resolve hook that appends ".js" to that one specifier so
// the untouched source modules load. Nothing here is a copy of the mapper.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(spec, ctx, next) {
         if (spec === "./parse") {
           try { return await next(spec, ctx); }
           catch { return next(spec + ".js", ctx); }
         }
         return next(spec, ctx);
       }`,
    ),
  import.meta.url,
);

let normalizeCategory, normalizeMovie, normalizeChannel, normalizeSeries, parseRating;

before(async () => {
  ({ normalizeCategory } = await import("../Category.js"));
  ({ normalizeChannel } = await import("../Channel.js"));
  ({ normalizeMovie } = await import("../Movie.js"));
  ({ normalizeSeries } = await import("../Series.js"));
  ({ parseRating } = await import("../parse.js"));
});

// ── parseRating (shared rating coercion used by Movie/Series) ──────────────────

describe("parseRating", () => {
  test("returns null for null/undefined/empty string", () => {
    assert.equal(parseRating(null), null);
    assert.equal(parseRating(undefined), null);
    assert.equal(parseRating(""), null);
  });

  test("passes numbers through", () => {
    assert.equal(parseRating(7.5), 7.5);
    assert.equal(parseRating(0), 0);
  });

  test("parses numeric strings, null when non-numeric", () => {
    assert.equal(parseRating("8.1"), 8.1);
    assert.equal(parseRating("N/A"), null);
  });
});

// ── Category ────────────────────────────────────────────────────────────────

describe("normalizeCategory", () => {
  test("maps category_id and category_name to id/name", () => {
    const result = normalizeCategory({ category_id: "42", category_name: "Action" });
    assert.equal(result.id, "42");
    assert.equal(result.name, "Action");
    assert.equal(result.parentId, null);
  });

  test("falls back to id/name when category_id/category_name absent", () => {
    const result = normalizeCategory({ id: 7, name: "Drama" });
    assert.equal(result.id, "7");
    assert.equal(result.name, "Drama");
  });

  test("maps parent_id to string", () => {
    const result = normalizeCategory({ category_id: "1", category_name: "Sub", parent_id: 2 });
    assert.equal(result.parentId, "2");
  });

  test("returns empty string id when no id field present", () => {
    const result = normalizeCategory({ category_name: "Unknown" });
    assert.equal(result.id, "");
  });

  test("coerces numeric category_id to a String id (ContentService dedup relies on this)", () => {
    const result = normalizeCategory({ category_id: 42, category_name: "Action" });
    assert.equal(result.id, "42");
    assert.equal(typeof result.id, "string");
  });
});

// ── Movie ───────────────────────────────────────────────────────────────────

describe("normalizeMovie", () => {
  test("exposes id alias for stream_id", () => {
    const raw = { stream_id: 101, name: "Test Movie" };
    const result = normalizeMovie(raw);
    assert.equal(result.id, 101);
    assert.equal(result.stream_id, 101); // backward compat spread
  });

  test("id falls back to streamId when stream_id absent", () => {
    assert.equal(normalizeMovie({ streamId: 55 }).id, 55);
  });

  test("poster fallback order: stream_icon → cover → movie_image → null", () => {
    assert.equal(
      normalizeMovie({ stream_id: 1, stream_icon: "icon.jpg", cover: "c.jpg", movie_image: "m.jpg" }).poster,
      "icon.jpg",
    );
    assert.equal(normalizeMovie({ stream_id: 1, cover: "c.jpg", movie_image: "m.jpg" }).poster, "c.jpg");
    assert.equal(normalizeMovie({ stream_id: 1, movie_image: "m.jpg" }).poster, "m.jpg");
    assert.equal(normalizeMovie({ stream_id: 1 }).poster, null);
  });

  test("defaults containerExtension to mp4", () => {
    assert.equal(normalizeMovie({ stream_id: 1 }).containerExtension, "mp4");
    assert.equal(normalizeMovie({ stream_id: 1, container_extension: "mkv" }).containerExtension, "mkv");
  });

  test("prefers tmdb_rating over rating, null when invalid/absent", () => {
    assert.equal(normalizeMovie({ stream_id: 1, rating: "7.5" }).rating, 7.5);
    assert.equal(normalizeMovie({ stream_id: 1, tmdb_rating: "8.1", rating: "1.0" }).rating, 8.1);
    assert.equal(normalizeMovie({ stream_id: 1, rating: "N/A" }).rating, null);
    assert.equal(normalizeMovie({ stream_id: 1 }).rating, null);
  });

  test("categoryId is stringified", () => {
    assert.equal(normalizeMovie({ stream_id: 1, category_id: 5 }).categoryId, "5");
    assert.equal(typeof normalizeMovie({ stream_id: 1, category_id: 5 }).categoryId, "string");
    assert.equal(normalizeMovie({ stream_id: 1 }).categoryId, null);
  });
});

// ── Channel ─────────────────────────────────────────────────────────────────

describe("normalizeChannel", () => {
  test("maps stream_id → id and stream_icon → logo", () => {
    const raw = { stream_id: 200, stream_icon: "logo.png", name: "BBC" };
    const result = normalizeChannel(raw);
    assert.equal(result.id, 200);
    assert.equal(result.logo, "logo.png");
    assert.equal(result.stream_id, 200); // backward compat
  });

  test("logo is null when stream_icon absent", () => {
    assert.equal(normalizeChannel({ stream_id: 1 }).logo, null);
  });

  test("defaults streamType to live", () => {
    assert.equal(normalizeChannel({ stream_id: 1 }).streamType, "live");
    assert.equal(normalizeChannel({ stream_id: 1, stream_type: "radio" }).streamType, "radio");
  });

  test("maps epg_channel_id → epgId", () => {
    assert.equal(normalizeChannel({ stream_id: 1, epg_channel_id: "EPG123" }).epgId, "EPG123");
    assert.equal(normalizeChannel({ stream_id: 1 }).epgId, null);
  });

  test("categoryId is stringified", () => {
    assert.equal(normalizeChannel({ stream_id: 1, category_id: 9 }).categoryId, "9");
    assert.equal(typeof normalizeChannel({ stream_id: 1, category_id: 9 }).categoryId, "string");
    assert.equal(normalizeChannel({ stream_id: 1 }).categoryId, null);
  });
});

// ── Series ──────────────────────────────────────────────────────────────────

describe("normalizeSeries", () => {
  test("maps series_id → id and cover → poster", () => {
    const raw = { series_id: 300, cover: "cover.jpg", name: "Westworld" };
    const result = normalizeSeries(raw);
    assert.equal(result.id, 300);
    assert.equal(result.poster, "cover.jpg");
    assert.equal(result.series_id, 300); // backward compat
  });

  test("id falls back to seriesId when series_id absent", () => {
    assert.equal(normalizeSeries({ seriesId: 88 }).id, 88);
  });

  test("poster fallback order: cover → backdrop_path → null", () => {
    assert.equal(normalizeSeries({ series_id: 1, cover: "c.jpg", backdrop_path: "b.jpg" }).poster, "c.jpg");
    assert.equal(normalizeSeries({ series_id: 1, backdrop_path: "b.jpg" }).poster, "b.jpg");
    assert.equal(normalizeSeries({ series_id: 1 }).poster, null);
  });

  test("rating parsed as float, null when absent", () => {
    assert.equal(normalizeSeries({ series_id: 1, rating: "9.0" }).rating, 9);
    assert.equal(normalizeSeries({ series_id: 1 }).rating, null);
  });

  test("genre takes first comma-separated value, trimmed", () => {
    assert.equal(normalizeSeries({ series_id: 1, genre: "Drama, Sci-Fi, Thriller" }).genre, "Drama");
    assert.equal(normalizeSeries({ series_id: 1 }).genre, null);
  });

  test("categoryId is stringified", () => {
    assert.equal(normalizeSeries({ series_id: 1, category_id: 3 }).categoryId, "3");
    assert.equal(typeof normalizeSeries({ series_id: 1, category_id: 3 }).categoryId, "string");
    assert.equal(normalizeSeries({ series_id: 1 }).categoryId, null);
  });
});
