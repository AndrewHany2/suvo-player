import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { fatalCause, cleanRawError, FATAL_TITLE } from "./playerCopy.js";

describe("fatalCause", () => {
  test("prefers the HTTP status: 4xx -> 'refused', 5xx -> 'server problem'", () => {
    assert.equal(fatalCause({ httpStatus: 406 }), "The server refused this stream (HTTP 406).");
    assert.equal(fatalCause({ httpStatus: 451 }), "The server refused this stream (HTTP 451).");
    assert.equal(fatalCause({ httpStatus: 500 }), "The stream server had a problem (HTTP 500).");
    assert.equal(fatalCause({ httpStatus: 503 }), "The stream server had a problem (HTTP 503).");
  });

  test("auth codes and reason map to the rejection line", () => {
    assert.equal(fatalCause({ httpStatus: 401 }), "The server rejected the connection.");
    assert.equal(fatalCause({ httpStatus: 403 }), "The server rejected the connection.");
    assert.equal(fatalCause({ reason: "AUTH_EXPIRED" }), "The server rejected the connection.");
  });

  test("404 / GONE map to 'no longer available'", () => {
    assert.equal(fatalCause({ httpStatus: 404 }), "This stream is no longer available.");
    assert.equal(fatalCause({ reason: "GONE" }), "This stream is no longer available.");
  });

  test("status wins over a generic reason (real 406 shows through UNPLAYABLE)", () => {
    assert.equal(
      fatalCause({ reason: "UNPLAYABLE", httpStatus: 406 }),
      "The server refused this stream (HTTP 406).",
    );
  });

  test("no status and unknown reason falls back to the generic line", () => {
    assert.equal(fatalCause({}), "The stream could not be played.");
    assert.equal(fatalCause({ reason: "UNPLAYABLE" }), "The stream could not be played.");
    assert.equal(fatalCause(), "The stream could not be played.");
  });
});

describe("cleanRawError", () => {
  test("strips engine boilerplate prefixes and trims", () => {
    assert.equal(
      cleanRawError("A playback exception has occurred: Source error Response code: 406"),
      "Response code: 406",
    );
    assert.equal(cleanRawError("Source error Response code: 406"), "Response code: 406");
    assert.equal(cleanRawError("  Response code: 500  "), "Response code: 500");
  });

  test("returns undefined for empty / non-string / boilerplate-only input", () => {
    assert.equal(cleanRawError(""), undefined);
    assert.equal(cleanRawError(undefined), undefined);
    assert.equal(cleanRawError(null), undefined);
    assert.equal(cleanRawError(42), undefined);
    assert.equal(cleanRawError("Source error"), undefined);
  });

  test("passes through a plain message unchanged", () => {
    assert.equal(cleanRawError("Network is unreachable"), "Network is unreachable");
  });
});

describe("FATAL_TITLE", () => {
  test("is a non-empty string", () => {
    assert.equal(typeof FATAL_TITLE, "string");
    assert.ok(FATAL_TITLE.length > 0);
  });
});
