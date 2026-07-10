import { XStack, Text } from "../../ui/primitives";
import Icon from "../../ui/Icon";
import { ss } from "../../utils/scaleSize";
import { colors, accentAlpha, GLOW_WEB, motion, easing, radii, fonts, fontWeights } from "../../ui/tokens";

import { isTV } from "../../utils/isTV";

/**
 * Discover category pills — web/TV. Shared by Movies & Series so the two
 * Discover rows can't drift apart again.
 *
 * Outline style: dark indigo-wash pill, cyan (accent2) border on the focused
 * item, indigo (accent) chevron. Each pill carries its own `id`/`label`;
 * `focusedCol` is the index of the focused pill (or -1 when focus is elsewhere).
 * The leading line-icon is derived from the pill id (film / tv / star).
 */

// Map a pill id to an Icon name. `all`/`movies` → film, `series`/`tv` → tv,
// `top`/`rated` → star. Anything else falls back to film so a new category
// degrades to a sensible glyph rather than nothing.
function iconFor(id) {
  const key = String(id || "").toLowerCase();
  if (key.includes("series") || key.includes("tv")) return "tv";
  if (key.includes("top") || key.includes("rated")) return "star";
  return "film";
}

export default function DiscoverPills({ items, focusedCol = -1, onSelect }) {
  const tv = isTV();
  return (
    <XStack gap={ss(tv ? 14 : 10)} flexWrap="wrap">
      {items.map((pill, idx) => {
        // Only TV (remote nav) shows a persistent focus ring on a pill. On
        // desktop there's a pointer, so the pill stays neutral until hover —
        // matching the Home screen's hover-only interaction language.
        const focused = tv && focusedCol === idx;
        return (
          <XStack
            key={pill.id}
            // Real button semantics: keyboard/AT users can Tab to the pill and
            // fire it with Enter/Space (the div still handles mouse via onPress).
            role="button"
            tabIndex={0}
            aria-label={pill.label}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                onSelect?.(pill);
              }
            }}
            alignItems="center" gap={ss(tv ? 12 : 10)} paddingHorizontal={ss(tv ? 26 : 18)} paddingVertical={ss(tv ? 16 : 11)}
            backgroundColor={focused ? accentAlpha(0.22) : accentAlpha(0.08)}
            borderWidth={1} borderStyle="solid"
            borderColor={focused ? colors.accent2 : accentAlpha(0.28)}
            borderRadius={radii.pill} cursor="pointer"
            onPress={() => onSelect?.(pill)}
            pressStyle={{ opacity: 0.75 }}
            // Cyan focus border + soft glow as the interaction language. TV gets
            // the instant border only (no shadow/transition on old Chromium).
            hoverStyle={{
              borderColor: colors.accent2,
              ...(tv ? null : { boxShadow: GLOW_WEB }),
            }}
            style={{
              // Glow is a hover-only affordance now (see hoverStyle); the
              // focus ring on TV is a plain border with no shadow.
              boxShadow: "none",
              transition: tv ? undefined : `border-color ${motion.fast}ms ${easing}, box-shadow ${motion.base}ms ${easing}`,
            }}
            {...{ className: "suvo-discover-pill" }}
          >
            <Icon name={iconFor(pill.id)} size={ss(tv ? 22 : 16)} color={colors.accent2} />
            <Text color={colors.text} fontSize={ss(tv ? 18 : 13)} fontWeight={fontWeights.medium} fontFamily={fonts.body} letterSpacing={0.1}>{pill.label}</Text>
            <Icon name="chevron-right" size={ss(tv ? 22 : 16)} color={colors.accent} />
          </XStack>
        );
      })}
    </XStack>
  );
}
