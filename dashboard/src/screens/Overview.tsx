import React, { useEffect, useState } from "react";
import { call, apiErrorMessage } from "../api";
import { useAuth } from "../auth";

type Account = {
  userId: string;
  username: string;
  status: string;
  expiresAt: string | null;
  suspended: boolean;
  devicesUsed: number;
  deviceLimit: number | null;
  note: string | null;
};

function expiringWithinDays(iso: string | null, days: number, now: number): boolean {
  if (!iso) return false;
  const diff = new Date(iso).getTime() - now;
  return diff <= days * 24 * 60 * 60 * 1000;
}

export default function Overview() {
  const { me } = useAuth();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    call<Account[]>("accounts.list").then(
      (rows) => {
        if (!cancelled) setAccounts(rows);
      },
      (e) => {
        if (!cancelled) setError(apiErrorMessage((e as Error).message));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // App.tsx never renders this screen without a `me` — guard is just for TS.
  if (!me) return null;

  const now = Date.now();
  const expiringSoon =
    accounts === null
      ? null
      : accounts.filter((a) => a.status === "ACTIVE" && expiringWithinDays(a.expiresAt, 7, now)).length;
  const activeDevices = accounts === null ? null : accounts.reduce((sum, a) => sum + a.devicesUsed, 0);

  const pending = accounts === null && !error;

  return (
    <div className="container">
      <h1>Overview</h1>
      {error && <p className="field-error">{error}</p>}
      <div className="stat-grid">
        <StatCard label="Account quota" value={`${me.quota.used} / ${me.quota.max}`} />
        <StatCard
          label="Expiring within 7 days"
          value={pending ? "…" : error ? "—" : String(expiringSoon)}
        />
        <StatCard
          label="Active devices"
          value={pending ? "…" : error ? "—" : String(activeDevices)}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
