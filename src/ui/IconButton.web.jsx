/**
 * IconButton — web/TV icon-first control (raw DOM <button>).
 *
 * The padded text `Button` primitive can't cleanly express the player's
 * fixed-square media controls (circular play/mute/close) or its selectable
 * option chips, so this sibling primitive owns the same Aurora interaction
 * language for those cases: Signal Cyan (accent2) focus ring + soft glow, shown
 * ONLY while focused/hovered — never at rest. Resting/selected coloring, shape,
 * and size come from the caller's `style` (Single-Light: selected paths use
 * Aurora Indigo `colors.accent`, resting stays on the steel/slate neutrals).
 *
 * Cross-platform reasoning mirrors Button.web.jsx:
 *  - Renders a real <button> so keyboard/remote focus + Enter/Space come free.
 *  - Old webOS TV Chromium: NO box-shadow, NO transitions, NO var(). The glow
 *    and transition are gated on isTV() and only ever emit literal token values.
 *  - Glow is driven by `isFocused` (parent/remote-tracked) OR local hover/focus.
 */
import { forwardRef, useState } from "react";
import { focusRing, motion, easing, GLOW_WEB } from "./tokens";
import { isTV } from "../utils/isTV";

const IconButton = forwardRef(function IconButton(
  { children, onPress, disabled = false, isFocused = false, style, ...rest },
  ref
) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const tv = isTV();
  const active = !disabled && (isFocused || hovered || focused);

  const css = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    cursor: disabled ? "default" : "pointer",
    ...style,
    // Caller may pass its own opacity; disabled dims regardless.
    opacity: disabled ? 0.5 : style?.opacity ?? 1,
    // Focus ring + glow are interaction-only. TV: ring stays (instant, no shadow);
    // desktop/web also gets the soft cyan glow. Never shown at rest.
    outline: active ? `${focusRing.width}px solid ${focusRing.color}` : "none",
    outlineOffset: active ? focusRing.offset : 0,
    boxShadow: active && !tv ? GLOW_WEB : style?.boxShadow ?? "none",
    transition: tv
      ? undefined
      : `box-shadow ${motion.base}ms ${easing}, outline-color ${motion.fast}ms ${easing}`,
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
      {children}
    </button>
  );
});

export default IconButton;
