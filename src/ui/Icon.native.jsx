/**
 * Icon — native (iOS/Android) line-icon set, same contract as Icon.web.jsx.
 *
 * react-native-svg is NOT installed and adding a dependency is forbidden, so we
 * cannot render the inline-SVG paths the web side uses. Instead:
 *
 *   - Core ACTION icons (play, plus, back, chevron-right, check, close) are built
 *     from plain <View>s using borders + rotation — crisp at any size, no glyph
 *     font to fall back on, recolour cleanly via the `color` prop.
 *   - CONTENT icons (star, film, tv, warning, search, settings) use clean,
 *     NON-EMOJI Unicode symbols rendered in a <Text>. These are dingbat/technical
 *     glyphs (★ ▦ etc.), not emoji, so they inherit `color` and never render as a
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
  film: "▦", // ▦ square with orthogonal fill (film-strip stand-in)
  tv: "▢", // ▢ white square with rounded corners (screen stand-in)
  warning: "!", // exclamation inside a bordered triangle (built below)
  search: "⌕", // ⌕ telephone recorder / magnifier glyph
  settings: "⚙", // ⚙ gear
};

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
    default: {
      // Content icons fall back to a clean non-emoji Unicode glyph.
      const glyph = GLYPHS[name];
      if (!glyph) return null;
      return <Glyph glyph={glyph} size={size} color={color} {...rest} />;
    }
  }
}

export default memo(Icon);
