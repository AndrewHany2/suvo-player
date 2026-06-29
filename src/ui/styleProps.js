/**
 * Shared style-prop plumbing for the cross-platform primitives in this folder.
 *
 * The screens were written against Tamagui's inline style-prop API
 * (`<YStack backgroundColor="#fff" paddingHorizontal={10} gap={8} />`). To drop
 * Tamagui without rewriting every JSX attribute, the primitives accept the same
 * prop surface and funnel the recognised keys through here:
 *
 *   - `splitStyleProps(props)` separates the style-ish props from behavioural
 *     props (onPress, children, value, …) and unknown passthrough.
 *   - `toWebStyle(styleProps)` expands the RN shorthands CSS lacks
 *     (paddingHorizontal → paddingLeft/Right) and adds `px` to length values.
 *   - On native the recognised keys are already valid RN style keys, so the
 *     native primitive just spreads them into `style`.
 */

// Recognised style keys (superset of the RN View/Text styles used in screens).
export const STYLE_KEYS = new Set([
  // color / opacity
  "backgroundColor", "color", "opacity",
  // flex
  "flex", "flexDirection", "flexGrow", "flexShrink", "flexBasis", "flexWrap",
  "alignItems", "alignSelf", "justifyContent", "gap", "rowGap", "columnGap",
  // box size
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "aspectRatio",
  // margin
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "marginHorizontal", "marginVertical",
  // padding
  "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "paddingHorizontal", "paddingVertical",
  // border
  "borderWidth", "borderColor", "borderRadius", "borderStyle",
  "borderTopColor", "borderBottomColor", "borderLeftColor", "borderRightColor",
  "borderTopWidth", "borderBottomWidth", "borderLeftWidth", "borderRightWidth",
  "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomLeftRadius", "borderBottomRightRadius",
  // position
  "position", "top", "bottom", "left", "right", "zIndex", "overflow",
  // text
  "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing",
  "textAlign", "textTransform", "textDecorationLine",
]);

// Numeric values that must stay unitless on the web (everything else → px).
const UNITLESS = new Set([
  "flex", "flexGrow", "flexShrink", "opacity", "zIndex", "aspectRatio",
  "fontWeight", "order",
]);

/**
 * Split incoming props into recognised style props and the rest.
 * @returns {{ styleProps: object, rest: object }}
 */
export function splitStyleProps(props) {
  const styleProps = {};
  const rest = {};
  for (const key in props) {
    if (STYLE_KEYS.has(key)) styleProps[key] = props[key];
    else rest[key] = props[key];
  }
  return { styleProps, rest };
}

function px(key, value) {
  if (typeof value !== "number") return value;
  if (UNITLESS.has(key)) return value;
  return `${value}px`;
}

/**
 * Convert recognised RN-style props into a CSS style object:
 * expand the shorthands CSS doesn't have, then px-ify length numbers.
 */
export function toWebStyle(styleProps) {
  const out = {};
  for (const key in styleProps) {
    const v = styleProps[key];
    switch (key) {
      case "paddingHorizontal":
        out.paddingLeft = px("paddingLeft", v); out.paddingRight = px("paddingRight", v); break;
      case "paddingVertical":
        out.paddingTop = px("paddingTop", v); out.paddingBottom = px("paddingBottom", v); break;
      case "marginHorizontal":
        out.marginLeft = px("marginLeft", v); out.marginRight = px("marginRight", v); break;
      case "marginVertical":
        out.marginTop = px("marginTop", v); out.marginBottom = px("marginBottom", v); break;
      default:
        out[key] = px(key, v);
    }
  }
  return out;
}
