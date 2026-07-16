// Literal read so babel-preset-expo's expoInlineEnvVars plugin inlines it into
// the Hermes bundle at build time. Do NOT destructure/alias process.env or the
// inline won't happen. Unset/invalid => not a demo build => never locks.
const RAW = process.env.EXPO_PUBLIC_DEMO_EXPIRES_AT || "";
export function demoExpiryMs() {
  const t = Date.parse(RAW);
  return Number.isFinite(t) ? t : null; // null => feature off
}
