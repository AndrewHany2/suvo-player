// @ts-check
/**
 * Unit tests for the PURE quality-cap ladder helpers extracted from usePlayer.js.
 *
 * These encode the manual-cap ↔ auto-downgrade CEILING CONTRACT: a manual quality
 * pick maps to a cap the recovery machine treats as the best quality auto-restore
 * may reach (it can drop below, never above). `levelForCap` reverses the mapping
 * to pin a concrete hls.js level for a remembered cap.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  heightToCap,
  capToMaxHeight,
  levelForCap,
  getLevelLabel,
} from "./qualityCap.js";

describe("heightToCap", () => {
  test("falsy height => 'auto'", () => {
    assert.equal(heightToCap(0), "auto");
    assert.equal(heightToCap(undefined), "auto");
    assert.equal(heightToCap(null), "auto");
  });

  test("maps a height to the ladder value at/above each rung", () => {
    assert.equal(heightToCap(1080), "1080");
    assert.equal(heightToCap(1920), "1080");
    assert.equal(heightToCap(720), "720");
    assert.equal(heightToCap(900), "720");
    assert.equal(heightToCap(480), "480");
    assert.equal(heightToCap(600), "480");
    assert.equal(heightToCap(360), "data-saver");
    assert.equal(heightToCap(100), "data-saver");
  });
});

describe("capToMaxHeight", () => {
  test("each ladder value maps to its numeric ceiling", () => {
    assert.equal(capToMaxHeight("1080"), 1080);
    assert.equal(capToMaxHeight("720"), 720);
    assert.equal(capToMaxHeight("480"), 480);
    assert.equal(capToMaxHeight("data-saver"), 360);
  });

  test("'auto' / unknown => Infinity (no cap)", () => {
    assert.equal(capToMaxHeight("auto"), Infinity);
    assert.equal(capToMaxHeight(undefined), Infinity);
    assert.equal(capToMaxHeight("nonsense"), Infinity);
  });
});

describe("levelForCap", () => {
  const levels = [{ height: 360 }, { height: 720 }, { height: 1080 }];

  test("no cap / empty / non-array => -1 (Auto)", () => {
    assert.equal(levelForCap(levels, "auto"), -1);
    assert.equal(levelForCap(levels, undefined), -1);
    assert.equal(levelForCap([], "720"), -1);
    assert.equal(levelForCap(null, "720"), -1);
  });

  test("picks the tallest level at or below the cap", () => {
    assert.equal(levelForCap(levels, "1080"), 2);
    assert.equal(levelForCap(levels, "720"), 1);
    assert.equal(levelForCap(levels, "480"), 0); // only the 360 level qualifies
  });

  test("returns -1 when no level is at or below the cap", () => {
    assert.equal(levelForCap([{ height: 1080 }], "480"), -1);
  });
});

describe("getLevelLabel", () => {
  test("no height => rounded bitrate in k", () => {
    assert.equal(getLevelLabel({ bitrate: 500000 }, []), "500k");
    assert.equal(getLevelLabel({ height: 0, bitrate: 800000 }, []), "800k");
  });

  test("unique height => '<h>p'", () => {
    const levels = [{ height: 720, bitrate: 2500000 }];
    assert.equal(getLevelLabel(levels[0], levels), "720p");
  });

  test("duplicate height => '<h>p (<k>k)' to disambiguate", () => {
    const levels = [
      { height: 720, bitrate: 2500000 },
      { height: 720, bitrate: 4000000 },
    ];
    assert.equal(getLevelLabel(levels[0], levels), "720p (2500k)");
    assert.equal(getLevelLabel(levels[1], levels), "720p (4000k)");
  });
});
