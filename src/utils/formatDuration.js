/** Format seconds as `M:SS`, or `H:MM:SS` once past an hour. Invalid/≤0 → "0:00". */
export function formatDuration(seconds) {
  const n = Number(seconds);
  const s = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
