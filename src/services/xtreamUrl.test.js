import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseXtreamCredsFromUrl } from "./xtreamUrl.js";

describe("parseXtreamCredsFromUrl", () => {
  test("get.php m3u_plus link → derived Xtream creds", () => {
    assert.deepEqual(
      parseXtreamCredsFromUrl(
        "http://host.tv:8080/get.php?username=alice&password=s3cret&type=m3u_plus&output=ts",
      ),
      { host: "http://host.tv:8080", username: "alice", password: "s3cret" },
    );
  });

  test("player_api.php link is also accepted", () => {
    assert.deepEqual(
      parseXtreamCredsFromUrl("http://host.tv/player_api.php?password=p&username=u"),
      { host: "http://host.tv", username: "u", password: "p" },
    );
  });

  test("https scheme and port are preserved in host", () => {
    assert.equal(
      parseXtreamCredsFromUrl("https://cdn.example:2096/get.php?username=u&password=p").host,
      "https://cdn.example:2096",
    );
  });

  test("url-encoded credential values are decoded", () => {
    assert.deepEqual(
      parseXtreamCredsFromUrl("http://h/get.php?username=a%40b&password=p%20q"),
      { host: "http://h", username: "a@b", password: "p q" },
    );
  });

  test("plain hosted .m3u8 file → null (no embedded creds)", () => {
    assert.equal(parseXtreamCredsFromUrl("http://host.tv/playlist.m3u8"), null);
  });

  test("get.php missing password → null", () => {
    assert.equal(parseXtreamCredsFromUrl("http://host.tv/get.php?username=u"), null);
  });

  test("non-http / garbage → null", () => {
    assert.equal(parseXtreamCredsFromUrl("not a url"), null);
    assert.equal(parseXtreamCredsFromUrl(""), null);
    assert.equal(parseXtreamCredsFromUrl(null), null);
  });
});
