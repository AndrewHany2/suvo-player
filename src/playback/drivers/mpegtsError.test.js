import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMpegtsError } from "./mpegtsError.js";

test("classifies a network error type as kind 'network', always fatal", () => {
  const e = normalizeMpegtsError("NetworkError", "Bad", {});
  assert.equal(e.kind, "network");
  assert.equal(e.fatal, true);
  assert.equal(e.type, "NetworkError");
});

test("classifies a media error type as kind 'media'", () => {
  assert.equal(normalizeMpegtsError("MediaError", "x", {}).kind, "media");
});

test("matches network/media case-insensitively as a substring", () => {
  assert.equal(normalizeMpegtsError("NETWORK_EXCEPTION").kind, "network");
  assert.equal(normalizeMpegtsError("someMediaThing").kind, "media");
});

test("defaults unknown / empty / nullish error types to 'media' and fatal", () => {
  for (const t of ["Weird", "", null, undefined]) {
    const e = normalizeMpegtsError(t);
    assert.equal(e.kind, "media");
    assert.equal(e.fatal, true);
  }
});

test("copies a numeric info.code into httpStatus", () => {
  assert.equal(normalizeMpegtsError("NetworkError", "d", { code: 404 }).httpStatus, 404);
});

test("omits httpStatus when code is missing or non-numeric", () => {
  assert.equal("httpStatus" in normalizeMpegtsError("NetworkError", "d", {}), false);
  assert.equal("httpStatus" in normalizeMpegtsError("NetworkError", "d", { code: "404" }), false);
  assert.equal("httpStatus" in normalizeMpegtsError("NetworkError"), false);
});

test("preserves the original {errType, errDetail, info} triplet", () => {
  const info = { code: 500 };
  const e = normalizeMpegtsError("MediaError", "detail", info);
  assert.deepEqual(e.original, { errType: "MediaError", errDetail: "detail", info });
});

test("stringifies a non-string error type", () => {
  assert.equal(normalizeMpegtsError(123).type, "123");
});
