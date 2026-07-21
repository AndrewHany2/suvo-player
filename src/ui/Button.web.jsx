/**
 * Button — web/TV implementation (raw DOM <button>).
 *
 * The Tamagui-era screens spelled buttons as ad-hoc `<YStack onPress>` blobs;
 * this is the single primitive that replaces them. Same Aurora interaction
 * language as the rest of the kit: cyan (accent2) focus ring + soft glow, shown
 * ONLY while focused/hovered — never at rest.
 *
 * Cross-platform reasoning:
 *  - Renders a real <button> so keyboard/remote focus + Enter/Space activation
 *    come for free (TV remote OK on old webOS Chromium).
 *  - Old webOS TV Chromium: NO box-shadow, NO CSS transitions, NO var(). We gate
 *    every glow/transition on isTV() and only ever emit literal values (tokens
 *    resolve to literal hex/rgba in JS), so nothing depends on custom properties.
 *  - Glow is driven by `isFocused` (remote/keyboard focus the caller tracks) OR
 *    by local hover/focus state, applied inline — global CSS lives in
 *    AppNavigator, so this component owns its own interaction styling.
 *  - Sizing flows through ss() so padding + type scale on TV/web.
 */
import { forwardRef, useState } from "react";
import { colors, focusRing, motion, easing, GLOW_WEB, radii, fonts, fontWeights } from "./tokens";
import { ss } from "../utils/scaleSize";
import Icon from "./Icon";

import { isTV } from "../utils/isTV";

// Size ramp (authored at 1920×1080 reference; ss() scales it). paddingV/H +
// fontSize + matching icon box per size.
const SIZES = {
  sm: { padV: 8, padH: 14, font: 14, icon: 16, gap: 6 },
  md: { padV: 11, padH: 20, font: 16, icon: 20, gap: 8 },
  lg: { padV: 15, padH: 28, font: 20, icon: 24, gap: 10 },
};

// Per-variant resting colors. Glow/ring are layered on top for focus/hover.
function variantStyle(variant) {
  switch (variant) {
    case "secondary":
      return { backgroundColor: colors.surface2, color: colors.text, border: `1px solid ${colors.border}` };
    case "ghost":
      return { backgroundColor: "transparent", color: colors.accent, border: "1px solid transparent" };
    case "primary":
    default:
      // AA: white label (~5:1) on the indigo fill; colors.text (#EAF0FF) was ~4.26:1 (< 4.5).
      return { backgroundColor: colors.accent, color: colors.textStrong, border: "1px solid transparent" };
  }
}

const Button = forwardRef(function Button(
  { variant = "primary", size = "md", icon, children, onPress, disabled = false, isFocused = false, style, ...rest },
  ref
) {
  // Local hover/focus tracks mouse + tab focus on desktop; `isFocused` lets a
  // parent (e.g. TV FocusManager) drive the glow for remote navigation.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const tv = isTV();
  const active = !disabled && (isFocused || hovered || focused);

  const sz = SIZES[size] || SIZES.md;
  const v = variantStyle(variant);

  const css = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: ss(sz.gap),
    paddingTop: ss(sz.padV),
    paddingBottom: ss(sz.padV),
    paddingLeft: ss(sz.padH),
    paddingRight: ss(sz.padH),
    borderRadius: radii.sm,
    fontFamily: fonts.body,
    fontWeight: fontWeights.medium,
    fontSize: ss(sz.font),
    lineHeight: 1.2,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    ...v,
    // Focus ring + glow are interaction-only. TV: ring stays (instant, no shadow);
    // desktop/web also gets the soft cyan glow. Never shown at rest.
    outline: active ? `${focusRing.width}px solid ${focusRing.color}` : "none",
    outlineOffset: active ? focusRing.offset : 0,
    boxShadow: active && !tv ? GLOW_WEB : "none",
    // Smooth the glow/ring on web only — TV strips animations (jank on old Chromium).
    transition: tv ? undefined : `box-shadow ${motion.base}ms ${easing}, outline-color ${motion.fast}ms ${easing}`,
    ...style,
  };

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={css}
      {...rest}
    >
      {icon ? <Icon name={icon} size={ss(sz.icon)} color={v.color} /> : null}
      {children}
    </button>
  );
});

export default Button;
