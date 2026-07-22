/**
 * StatePanel — the one shared loading / error / empty surface.
 *
 * Movies, Series, LiveTV, History, Accounts, Settings and Auth each used to
 * hand-roll their own centered spinner / error / "nothing here" block. This is
 * the single component that replaces all of them, so the three states look and
 * behave identically everywhere.
 *
 * Cross-platform reasoning:
 *  - This is ONE file (no .web/.native split) because it is built entirely from
 *    the shared primitives (YStack/Text/Spinner), Button and Icon — each of
 *    which already resolves per platform (primitives.{web,native}, Button.*,
 *    Icon.*). So this layout is identical DOM-vs-RN and works on web/native/TV
 *    with no platform branch of its own.
 *  - No hardcoded hex: colours come from tokens; sizes flow through ss() so the
 *    glyph + padding scale on TV/web. Nothing here uses var(), animation, or
 *    box-shadow directly, so old webOS Chromium is happy (the Spinner already
 *    drops its animation on TV internally).
 */
import { YStack, Text, Spinner } from "./primitives";
import Button from "./Button";
import Icon from "./Icon";
import { colors, fonts, fontWeights, iconSizes } from "./tokens";
import { ss } from "../utils/scaleSize";
import LABELS from "./labels";

export default function StatePanel({
  mode,
  title,
  message,
  icon,
  onRetry,
  retryLabel = LABELS.retry,
  cta,
  ctaLabel,
  // TV D-pad: the screen's key router owns focus, so it tells the panel when its
  // Retry / CTA button is the focused target. Drives Button's cyan focus ring
  // (isFocused). Defaults false → no change on web/native (which focus natively).
  retryFocused = false,
  ctaFocused = false,
}) {
  // Full-flex centered shell shared by every mode: midnight bg, generous pad so
  // the panel reads as a deliberate empty-state rather than a stranded widget.
  const shell = {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: ss(24),
    gap: ss(12),
    backgroundColor: colors.bg,
  };

  // Muted secondary copy, centered + width-capped so long messages wrap nicely.
  const mutedText = {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: ss(16),
    textAlign: "center",
    maxWidth: ss(420),
  };

  if (mode === "loading") {
    return (
      // role=status + polite live region → screen readers announce the loading
      // title/message when it appears without stealing focus. (RN maps these
      // ARIA props to accessibilityRole/accessibilityLiveRegion.)
      <YStack {...shell} role="status" aria-live="polite">

        <Spinner size="large" color={colors.accent} />
        {title ? <Text {...mutedText} marginTop={ss(8)}>{title}</Text> : null}
        {message ? <Text {...mutedText}>{message}</Text> : null}
      </YStack>
    );
  }

  if (mode === "error") {
    return (
      // role=alert → assertive announcement so an error interrupts and is read out.
      <YStack {...shell} role="alert">

        <Icon name="warning" size={ss(iconSizes.lg)} color={colors.danger} />
        {title ? (
          <Text
            color={colors.danger}
            fontFamily={fonts.display}
            fontWeight={fontWeights.bold}
            fontSize={ss(20)}
            textAlign="center"
          >
            {title}
          </Text>
        ) : null}
        {message ? <Text {...mutedText}>{message}</Text> : null}
        {onRetry ? (
          <Button variant="primary" isFocused={retryFocused} onPress={onRetry} style={{ marginTop: ss(8) }}>
            {retryLabel}
          </Button>
        ) : null}
      </YStack>
    );
  }

  // 'empty' (default): caller-provided glyph, falling back to a film strip.
  return (
    <YStack {...shell}>
      <Icon name={icon || "film"} size={ss(iconSizes.lg)} color={colors.muted} />
      {title ? (
        <Text
          color={colors.text}
          fontFamily={fonts.display}
          fontWeight={fontWeights.bold}
          fontSize={ss(20)}
          textAlign="center"
        >
          {title}
        </Text>
      ) : null}
      {message ? <Text {...mutedText}>{message}</Text> : null}
      {cta ? (
        <Button variant="primary" isFocused={ctaFocused} onPress={cta} style={{ marginTop: ss(8) }}>
          {ctaLabel}
        </Button>
      ) : null}
    </YStack>
  );
}
