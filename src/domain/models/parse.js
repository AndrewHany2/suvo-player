/** Coerce a raw rating (number | numeric string | ""/null) to a number or null. */
export function parseRating(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isNaN(n) ? null : n;
}
