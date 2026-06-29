import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  clampOffset,
  formatOffset,
  toCssTextTrackStyle,
  toNativeSubtitleProps,
  DEFAULT_SUBTITLE_STYLE,
  OFFSET_MIN_MS,
  OFFSET_MAX_MS,
} from "./subtitleStyle.js";

describe("clampOffset", () => {
  test("passes through values inside the range", () => {
    assert.equal(clampOffset(0), 0);
    assert.equal(clampOffset(1500), 1500);
    assert.equal(clampOffset(-2500), -2500);
  });

  test("clamps to the upper bound", () => {
    assert.equal(clampOffset(OFFSET_MAX_MS), OFFSET_MAX_MS);
    assert.equal(clampOffset(OFFSET_MAX_MS + 1), OFFSET_MAX_MS);
    assert.equal(clampOffset(999999), OFFSET_MAX_MS);
  });

  test("clamps to the lower bound", () => {
    assert.equal(clampOffset(OFFSET_MIN_MS), OFFSET_MIN_MS);
    assert.equal(clampOffset(OFFSET_MIN_MS - 1), OFFSET_MIN_MS);
    assert.equal(clampOffset(-999999), OFFSET_MIN_MS);
  });

  test("non-finite input clamps to 0", () => {
    assert.equal(clampOffset(NaN), 0);
    assert.equal(clampOffset(/** @type {any} */ (undefined)), 0);
    assert.equal(clampOffset(/** @type {any} */ ("x")), 0);
  });
});

describe("formatOffset", () => {
  test("zero renders without a sign", () => {
    assert.equal(formatOffset(0), "0s");
  });

  test("positive offsets are signed", () => {
    assert.equal(formatOffset(1500), "+1.5s");
    assert.equal(formatOffset(1000), "+1s");
    assert.equal(formatOffset(250), "+0.25s");
  });

  test("negative offsets are signed", () => {
    assert.equal(formatOffset(-2250), "-2.25s");
    assert.equal(formatOffset(-500), "-0.5s");
  });

  test("trims trailing zeros to ms precision", () => {
    assert.equal(formatOffset(1250), "+1.25s");
    assert.equal(formatOffset(1), "+0.001s");
  });

  test("non-finite input renders as 0s", () => {
    assert.equal(formatOffset(NaN), "0s");
    assert.equal(formatOffset(/** @type {any} */ (undefined)), "0s");
  });
});

describe("toCssTextTrackStyle", () => {
  test("uses defaults when no override given", () => {
    const css = toCssTextTrackStyle();
    assert.equal(css.fontSize, `${DEFAULT_SUBTITLE_STYLE.fontSize}px`);
    assert.equal(css.color, DEFAULT_SUBTITLE_STYLE.color);
    assert.equal(css.lineAlign, "start");
  });

  test("converts hex bg + opacity to rgba", () => {
    const css = toCssTextTrackStyle({ backgroundColor: "#0A0E1A", opacity: 0.5 });
    assert.equal(css.backgroundColor, "rgba(10,14,26,0.5)");
  });

  test("middle position maps to centered line align", () => {
    assert.equal(toCssTextTrackStyle({ position: "middle" }).lineAlign, "center");
  });

  test("edge styles map to a text-shadow", () => {
    assert.equal(toCssTextTrackStyle({ edgeStyle: "none" }).textShadow, "none");
    assert.ok(toCssTextTrackStyle({ edgeStyle: "outline" }).textShadow.includes("#000"));
    assert.ok(toCssTextTrackStyle({ edgeStyle: "drop-shadow" }).textShadow.includes("rgba"));
  });
});

describe("toNativeSubtitleProps", () => {
  test("returns numeric fontSize/opacity and validated enums", () => {
    const p = toNativeSubtitleProps({ fontSize: 30, opacity: 1.5, position: "middle" });
    assert.equal(p.fontSize, 30);
    assert.equal(p.opacity, 1); // clamped
    assert.equal(p.position, "middle");
    assert.equal(p.edgeStyle, "outline");
  });

  test("falls back to outline for an unknown edge style", () => {
    const p = toNativeSubtitleProps({ edgeStyle: /** @type {any} */ ("bogus") });
    assert.equal(p.edgeStyle, "outline");
  });
});
