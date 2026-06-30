/**
 * Icon — native (iOS/Android) line-icon set, same contract as Icon.web.jsx.
 *
 * react-native-svg is NOT installed and adding a dependency is forbidden, so we
 * cannot render the inline-SVG paths the web side uses. Instead:
 *
 *   - ACTION + nav icons (play, plus, back, chevron-right, check, close, user, tv,
 *     film, series, history) are built from plain <View>s using borders + rotation
 *     — crisp at any size, no glyph font to fall back on, recolour cleanly via the
 *     `color` prop. The four bottom-tab icons live here so the bar reads as one
 *     consistent line-icon set.
 *   - Remaining CONTENT icons (star, warning, search, settings, signal) use clean,
 *     NON-EMOJI Unicode symbols rendered in a <Text>. These are dingbat/technical
 *     glyphs (★ etc.), not emoji, so they inherit `color` and never render as a
 *     coloured emoji picture.
 *
 * Contract: <Icon name size color ...rest />. `size` is a px number (already
 * scaled by the caller). Unknown names render null so a typo degrades gracefully.
 */
import { memo } from "react";
import { View, Text } from "react-native";
import { colors } from "./tokens";

// Non-emoji Unicode glyphs for the content icons. Chosen to be monochrome
// symbol/dingbat codepoints (NOT emoji) so they take the text `color`.
const GLYPHS = {
  star: "★", // ★ black star
  warning: "!", // exclamation inside a bordered triangle (built below)
  search: "⌕", // ⌕ telephone recorder / magnifier glyph
  settings: "⚙", // ⚙ gear
  signal: "⦿", // ⦿ circled bullet (broadcast source stand-in)
};
// film / tv / series / history are drawn from <View>s (below) so the bottom-tab
// bar reads as a clean, consistent line-icon set instead of mismatched dingbats.

// A right-pointing triangle (play) made from a zero-size View whose left border
// is coloured and whose top/bottom borders are transparent — the classic CSS
// triangle trick, which RN supports.
function PlayTriangle({ size, color }) {
  const h = size; // triangle height ≈ icon box
  const w = size * 0.82; // visual width a touch narrower than tall
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: h / 2,
        borderBottomWidth: h / 2,
        borderLeftWidth: w,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: color,
      }}
    />
  );
}

// A chevron: an open right-angle corner made of two borders on a square, rotated
// 45° so it reads as a ">". `rotate` lets us reuse it for back ("<") too.
function Chevron({ size, color, rotate }) {
  const s = size * 0.5;
  const t = Math.max(2, size / 11);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: s,
          height: s,
          borderRightWidth: t,
          borderTopWidth: t,
          borderColor: color,
          transform: [{ rotate: `${rotate}deg` }],
        }}
      />
    </View>
  );
}

// A plus / cross: two crossed bars centred in the box.
function Plus({ size, color }) {
  const t = Math.max(2, size / 9);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: size * 0.78, height: t, backgroundColor: color, borderRadius: t / 2 }} />
      <View style={{ position: "absolute", width: t, height: size * 0.78, backgroundColor: color, borderRadius: t / 2 }} />
    </View>
  );
}

// An X / close: two crossed bars rotated ±45°.
function Close({ size, color }) {
  const t = Math.max(2, size / 9);
  const len = size * 0.82;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: len, height: t, backgroundColor: color, borderRadius: t / 2, transform: [{ rotate: "45deg" }] }} />
      <View style={{ position: "absolute", width: len, height: t, backgroundColor: color, borderRadius: t / 2, transform: [{ rotate: "-45deg" }] }} />
    </View>
  );
}

// A checkmark: a short and a long bar joined at a corner, rotated so it reads
// as a tick (an L rotated ~45°, with one arm shortened).
function Check({ size, color }) {
  const t = Math.max(2, size / 9);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size * 0.55,
          height: size * 0.28,
          borderLeftWidth: t,
          borderBottomWidth: t,
          borderColor: color,
          transform: [{ rotate: "-45deg" }],
          marginTop: -size * 0.06,
        }}
      />
    </View>
  );
}

// A warning triangle (CSS-triangle outline is awkward in RN, so we draw a filled
// triangle in `color` and overlay an exclamation in the bg colour for contrast).
function Warning({ size, color }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size / 2,
          borderRightWidth: size / 2,
          borderBottomWidth: size * 0.86,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
        }}
      />
      <Text
        style={{
          position: "absolute",
          bottom: size * 0.08,
          color: colors.bg,
          fontSize: size * 0.5,
          fontWeight: "700",
          lineHeight: size * 0.5,
        }}
      >
        !
      </Text>
    </View>
  );
}

// A user / person silhouette: a filled head circle above a rounded "shoulders"
// bar. Drawn from Views (no clean non-emoji person glyph exists in basic Unicode).
function UserShape({ size, color }) {
  const head = size * 0.34;
  const bodyW = size * 0.7;
  const bodyH = size * 0.4;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: head, height: head, borderRadius: head / 2, backgroundColor: color, marginBottom: size * 0.06 }} />
      <View style={{ width: bodyW, height: bodyH, borderTopLeftRadius: bodyW / 2, borderTopRightRadius: bodyW / 2, backgroundColor: color }} />
    </View>
  );
}

// TV / monitor: a rounded screen outline on a short stand (stem + base bar) —
// mirrors the web `tv` path (rect + M8 21h8 M12 17v4).
function TvShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 11));
  const w = size * 0.84;
  const h = size * 0.56;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: w, height: h, borderWidth: t, borderColor: color, borderRadius: Math.max(2, size * 0.14) }} />
      <View style={{ width: t, height: size * 0.08, backgroundColor: color, marginTop: t / 2 }} />
      <View style={{ width: size * 0.4, height: t, backgroundColor: color, borderRadius: t / 2, marginTop: t / 2 }} />
    </View>
  );
}

// A vertical column of 3 sprocket holes — the film strip's defining feature.
function HoleColumn({ hole, color }) {
  return (
    <View style={{ height: "100%", justifyContent: "space-evenly", alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: hole, height: hole, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}

// Film strip: an outlined frame with a column of sprocket holes down each side —
// mirrors the web `film` path (rect + side hole columns).
function FilmShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  const w = size * 0.86;
  const h = size * 0.78;
  const hole = Math.max(2, Math.round(size * 0.085));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: w, height: h, borderWidth: t, borderColor: color, borderRadius: Math.max(2, size * 0.1), flexDirection: "row", justifyContent: "space-between", paddingHorizontal: Math.max(1, t * 0.6) }}>
        <HoleColumn hole={hole} color={color} />
        <HoleColumn hole={hole} color={color} />
      </View>
    </View>
  );
}

// Series / stacked collection: two offset rounded-square outlines — mirrors the
// web `series` path (two overlapping rounded rects).
function SeriesShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  const s = size * 0.6;
  const off = size * 0.18;
  const span = s + off;
  const r = Math.max(2, size * 0.12);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: span, height: span }}>
        <View style={{ position: "absolute", top: 0, left: 0, width: s, height: s, borderWidth: t, borderColor: color, borderRadius: r }} />
        <View style={{ position: "absolute", bottom: 0, right: 0, width: s, height: s, borderWidth: t, borderColor: color, borderRadius: r }} />
      </View>
    </View>
  );
}

// History / clock: a ring with a minute hand (up) + hour hand (right) meeting at
// centre — mirrors the web `history` path (circle + M12 7v5l3 2).
function ClockShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  const d = Math.round(size * 0.86);
  const inn = d - 2 * t;
  const c = inn / 2;
  const minH = c * 0.78;
  const hourW = c * 0.62;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: t, borderColor: color }}>
        <View style={{ position: "absolute", width: t, height: minH, backgroundColor: color, borderRadius: t / 2, left: c - t / 2, top: c - minH }} />
        <View style={{ position: "absolute", width: hourW, height: t, backgroundColor: color, borderRadius: t / 2, left: c, top: c - t / 2 }} />
      </View>
    </View>
  );
}

// Eye: a stadium/oval "lens" outline with a filled pupil. `off` overlays a
// diagonal slash so it reads as "hidden" — mirrors the web eye / eye-off paths.
function EyeShape({ size, color, off }) {
  const t = Math.max(2, Math.round(size / 12));
  const w = size * 0.92;
  const h = size * 0.56;
  const pupil = size * 0.26;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: w, height: h, borderWidth: t, borderColor: color, borderRadius: h / 2, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: pupil, height: pupil, borderRadius: pupil / 2, backgroundColor: color }} />
      </View>
      {off && (
        <View style={{ position: "absolute", width: size * 1.1, height: t, backgroundColor: color, borderRadius: t / 2, transform: [{ rotate: "-45deg" }] }} />
      )}
    </View>
  );
}

function Glyph({ glyph, size, color }) {
  return (
    <Text
      style={{
        width: size,
        height: size,
        fontSize: size * 0.92,
        lineHeight: size,
        textAlign: "center",
        color,
      }}
      // Defensive: a couple of these codepoints can be emoji-presented on some
      // OSes; the text variation selector below requests the plain glyph form.
      allowFontScaling={false}
    >
      {glyph}
      {"︎"}
    </Text>
  );
}

function Icon({ name, size = 20, color = colors.text, ...rest }) {
  // Geometric (View-based) action icons first — crispest, no glyph dependency.
  switch (name) {
    case "play":
      return <View {...rest}><PlayTriangle size={size} color={color} /></View>;
    case "plus":
      return <View {...rest}><Plus size={size} color={color} /></View>;
    case "chevron-right":
      return <View {...rest}><Chevron size={size} color={color} rotate={45} /></View>;
    case "back":
      return <View {...rest}><Chevron size={size} color={color} rotate={-135} /></View>;
    case "check":
      return <View {...rest}><Check size={size} color={color} /></View>;
    case "close":
      return <View {...rest}><Close size={size} color={color} /></View>;
    case "warning":
      return <View {...rest}><Warning size={size} color={color} /></View>;
    case "user":
      return <View {...rest}><UserShape size={size} color={color} /></View>;
    case "tv":
      return <View {...rest}><TvShape size={size} color={color} /></View>;
    case "film":
      return <View {...rest}><FilmShape size={size} color={color} /></View>;
    case "series":
      return <View {...rest}><SeriesShape size={size} color={color} /></View>;
    case "history":
      return <View {...rest}><ClockShape size={size} color={color} /></View>;
    case "eye":
      return <View {...rest}><EyeShape size={size} color={color} /></View>;
    case "eye-off":
      return <View {...rest}><EyeShape size={size} color={color} off /></View>;
    default: {
      // Content icons fall back to a clean non-emoji Unicode glyph.
      const glyph = GLYPHS[name];
      if (!glyph) return null;
      return <Glyph glyph={glyph} size={size} color={color} {...rest} />;
    }
  }
}

export default memo(Icon);
