// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  epgNowTitle,
  toFlatChannel,
  filterCategoriesBySearch,
} from "./useLiveTV.helpers.js";

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

const CATS = [
  { id: "sports", name: "Sports" },
  { id: "news", name: "News HD" },
  { id: "kids", name: "Kids" },
];
const CHANNELS = {
  sports: [
    { name: "ESPN", _lc: "espn" },
    { name: "Sky Sports", _lc: "sky sports" },
  ],
  news: [{ name: "BBC News", _lc: "bbc news" }],
  kids: [{ name: "Cartoon", _lc: "cartoon" }],
};
const chFor = (cat) => CHANNELS[cat.id];

test("filterCategoriesBySearch returns every category untouched for an empty query", () => {
  const out = filterCategoriesBySearch(CATS, "", chFor);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { id: "sports", name: "Sports", channels: CHANNELS.sports });
});

test("filterCategoriesBySearch keeps the whole category when its name matches", () => {
  const out = filterCategoriesBySearch(CATS, "sport", chFor);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "sports");
  // full channel list kept even though "sport" doesn't match every channel name
  assert.deepEqual(out[0].channels, CHANNELS.sports);
});

test("filterCategoriesBySearch filters by channel name when the category name doesn't match", () => {
  const out = filterCategoriesBySearch(CATS, "bbc", chFor);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "news");
  assert.deepEqual(out[0].channels, [{ name: "BBC News", _lc: "bbc news" }]);
});

test("filterCategoriesBySearch matches category name OR channel name across categories", () => {
  // "news" hits the "News HD" category name AND, incidentally, the BBC News channel.
  const out = filterCategoriesBySearch(CATS, "news", chFor);
  assert.deepEqual(out.map((c) => c.id), ["news"]);
  assert.deepEqual(out[0].channels, CHANNELS.news);
});

test("filterCategoriesBySearch drops categories with no name or channel match", () => {
  assert.deepEqual(filterCategoriesBySearch(CATS, "zzz", chFor), []);
});

test("filterCategoriesBySearch preserves null channels for an unloaded name-matched category", () => {
  const out = filterCategoriesBySearch(CATS, "kids", () => undefined);
  assert.equal(out.length, 1);
  assert.equal(out[0].channels, null);
});

test("filterCategoriesBySearch falls back to ch.name when _lc is absent", () => {
  const cats = [{ id: "c", name: "Misc" }];
  const out = filterCategoriesBySearch(cats, "gala", () => [{ name: "Galaxy TV" }]);
  assert.deepEqual(out[0].channels, [{ name: "Galaxy TV" }]);
});

test("toFlatChannel stores a search-normalized Arabic name in _lc", () => {
  // "الجزيرة" with a tatweel + harakat folds to the bare form.
  const out = toFlatChannel({ id: 1, name: "الجـزيرَة" }, (id) => `live/${id}`);
  assert.equal(out._lc, "الجزيره");
});

test("filterCategoriesBySearch matches an Arabic query across alef/diacritic variants", () => {
  const cats = [{ id: "ar", name: "قنوات عربية" }];
  const chFor = () => [{ name: "الجزيرة" }, { name: "MBC مصر" }];
  // Query typed with alef-hamza + trailing haa still matches "الجزيرة".
  const out = filterCategoriesBySearch(cats, "الجزيره", chFor);
  assert.deepEqual(out[0].channels, [{ name: "الجزيرة" }]);
});
