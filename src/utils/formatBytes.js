// Human-readable byte sizes for the downloads UI (e.g. "1.4 GB", "512 MB").
const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1);
  const value = n / 1024 ** i;
  // Whole numbers for bytes; one decimal for KB+ (trimmed when .0).
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[i]}`;
}
