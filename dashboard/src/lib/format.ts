export function statusLabel(status: string): { text: string; tone: "ok" | "warn" | "bad" } {
  switch (status) {
    case "ACTIVE": return { text: "Active", tone: "ok" };
    case "ACCOUNT_EXPIRED": return { text: "Expired", tone: "bad" };
    case "ACCOUNT_SUSPENDED": return { text: "Suspended", tone: "bad" };
    case "PROVIDER_SUSPENDED": return { text: "Provider suspended", tone: "bad" };
    default: return { text: status, tone: "warn" };
  }
}
export function expiryPreset(months: number, fromISO?: string): string {
  const base = fromISO ? new Date(fromISO) : new Date();
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}
export function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}
