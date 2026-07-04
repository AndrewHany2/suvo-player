// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { epgNowTitle, toFlatChannel } from "./useLiveTV.helpers.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("epgNowTitle decodes the base64 title of the first listing", () => {
  assert.equal(
    epgNowTitle({ epg_listings: [{ title: b64("Evening News") }] }),
    "Evening News",
  );
});

test("epgNowTitle returns '' when there is no listing", () => {
  assert.equal(epgNowTitle({ epg_listings: [] }), "");
  assert.equal(epgNowTitle({}), "");
  assert.equal(epgNowTitle(null), "");
  assert.equal(epgNowTitle(undefined), "");
});

test("epgNowTitle passes non-base64 titles through unchanged", () => {
  // atob throws on invalid input; decodeEpgTitle falls back to the raw string.
  assert.equal(epgNowTitle({ epg_listings: [{ title: "%%%" }] }), "%%%");
});

test("toFlatChannel builds the flat card shape with a lowercased name and built url", () => {
  const buildUrl = (id, ext) => `live/${id}.${ext}`;
  const out = toFlatChannel(
    { stream_id: 42, name: "BBC One", stream_icon: "http://x/logo.png" },
    buildUrl,
  );
  assert.deepEqual(out, {
    name: "BBC One",
    _lc: "bbc one",
    url: "live/42.m3u8",
    id: 42,
    stream_id: 42,
    logo: "http://x/logo.png",
  });
});

test("toFlatChannel falls back to id and .logo, and null logo when absent", () => {
  const buildUrl = (id, ext) => `live/${id}.${ext}`;
  const out = toFlatChannel({ id: 7, name: "Local", logo: "l.png" }, buildUrl);
  assert.equal(out.stream_id, 7);
  assert.equal(out.id, 7);
  assert.equal(out.logo, "l.png");
  const out2 = toFlatChannel({ id: 8, name: "NoLogo" }, buildUrl);
  assert.equal(out2.logo, null);
});
