/**
 * Button — native (iOS/Android) implementation.
 *
 * Same prop API as Button.web (variant/size/icon/children/onPress/disabled/
 * isFocused) so screens import the same name. Built on RN Pressable.
 *
 * Cross-platform reasoning:
 *  - Pressable gives the pressed-state feedback (opacity dip) that native users
 *    expect; the web build uses hover/focus instead.
 *  - The Aurora focus glow is a real native shadow (the `glow` token resolves to
 *    a shadow* / elevation object via Platform.select). Applied only when the
 *    button is the active/focused row (TV-style nav) — `isFocused` drives it,
 *    mirroring the web focus ring. There is no resting glow.
 *  - md/lg keep a ≥44px minHeight so they clear the platform minimum touch
 *    target even after ss() scaling on small devices.
 *  - Sizing flows through ss() so padding + type match the web ramp.
 */
import { forwardRef } from "react";
import { Pressable, Text } from "react-native";
import { colors, focusRing, glow, radii, fonts, fontWeights } from "./tokens";
import { ss } from "../utils/scaleSize";
import Icon from "./Icon";

// Size ramp mirrors Button.web. `minH` enforces the ≥44px touch target on md/lg.
const SIZES = {
  sm: { padV: 8, padH: 14, font: 14, icon: 16, gap: 6, minH: 0 },
  md: { padV: 11, padH: 20, font: 16, icon: 20, gap: 8, minH: 44 },
  lg: { padV: 15, padH: 28, font: 20, icon: 24, gap: 10, minH: 44 },
};

// Per-variant resting colors. Focus ring/glow layer on top.
function variantStyle(variant) {
  switch (variant) {
    case "secondary":
      return { backgroundColor: colors.surface2, color: colors.text, borderColor: colors.border, borderWidth: 1 };
    case "ghost":
      return { backgroundColor: "transparent", color: colors.accent, borderColor: "transparent", borderWidth: 1 };
    case "primary":
    default:
      return { backgroundColor: colors.accent, color: colors.text, borderColor: "transparent", borderWidth: 1 };
  }
}

const Button = forwardRef(function Button(
  { variant = "primary", size = "md", icon, children, onPress, disabled = false, isFocused = false, style, ...rest },
  ref
) {
  const sz = SIZES[size] || SIZES.md;
  const v = variantStyle(variant);

  const base = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ss(sz.gap),
    paddingVertical: ss(sz.padV),
    paddingHorizontal: ss(sz.padH),
    minHeight: sz.minH ? ss(sz.minH) : undefined,
    borderRadius: radii.sm,
    opacity: disabled ? 0.5 : 1,
    backgroundColor: v.backgroundColor,
    borderColor: v.borderColor,
    borderWidth: v.borderWidth,
    // Interaction-only cyan glow + ring; never shown at rest.
    ...(isFocused && !disabled ? { ...glow, borderColor: focusRing.color } : null),
  };

  return (
    <Pressable
      ref={ref}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [base, pressed && !disabled ? { opacity: 0.8 } : null, style]}
      {...rest}
    >
      {icon ? <Icon name={icon} size={ss(sz.icon)} color={v.color} /> : null}
      {children != null ? (
        <Text
          style={{
            color: v.color,
            fontFamily: fonts.body,
            fontWeight: fontWeights.medium,
            fontSize: ss(sz.font),
            lineHeight: ss(sz.font) * 1.2,
          }}
        >
          {children}
        </Text>
      ) : null}
    </Pressable>
  );
});

export default Button;
