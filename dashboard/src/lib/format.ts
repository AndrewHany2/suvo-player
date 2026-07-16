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

// Drives the expiry picker shared by CreateAccount (set) and AccountDetail
// (renew): a set of month presets, a custom date, or "never expires".
// `fromISO` anchors presets to a base other than "now" — e.g. renewing from
// the account's current expiry rather than today.
export type ExpiryChoice = "1" | "3" | "6" | "12" | "custom" | "never";
export function computeExpiresAt(choice: ExpiryChoice, customDate: string, fromISO?: string): string | null {
  if (choice === "never") return null;
  if (choice === "custom") {
    return customDate ? new Date(`${customDate}T00:00:00.000Z`).toISOString() : null;
  }
  return expiryPreset(Number(choice), fromISO);
}
export function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}
