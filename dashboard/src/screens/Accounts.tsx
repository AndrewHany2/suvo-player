import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { useAuth } from "../auth";
import { isSuperAdmin } from "../authGate";
import { statusLabel, fmtDate } from "../lib/format";
import { Badge, Button, ConfirmDialog, Table, type Column } from "../ui";

type Account = {
  userId: string;
  name: string;
  status: string;
  expiresAt: string | null;
  suspended: boolean;
  devicesUsed: number;
  deviceLimit: number | null;
  note: string | null;
  providerId: string | null;
  providerName: string | null;
};

type ProviderOption = { user_id: string; name: string; role: string };

const SEARCH_DEBOUNCE_MS = 300;

export default function Accounts() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const superAdmin = isSuperAdmin(me?.role ?? "");
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the super-admin Providers drill-in (/accounts?providerId=…) or by the
  // provider dropdown below. Ignored server-side for a provider caller — they
  // only ever see their own accounts regardless.
  const providerId = searchParams.get("providerId") || undefined;
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Super-admin only: provider options for the filter dropdown.
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  useEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    call<ProviderOption[]>("providers.list").then(
      (rows) => {
        if (!cancelled) setProviders(rows.filter((p) => p.role === "provider"));
      },
      () => {
        // Non-fatal: without options the dropdown is hidden but the list still works.
        if (!cancelled) setProviders([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [superAdmin]);

  // Suspend/unsuspend confirmation target + its own busy/error state.
  const [confirming, setConfirming] = useState<Account | null>(null);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const payload = { ...(search ? { search } : {}), ...(providerId ? { providerId } : {}) };
      call<Account[]>("accounts.list", payload).then(
        (rows) => {
          if (cancelled) return;
          setAccounts(rows);
          setLoading(false);
        },
        (e) => {
          if (cancelled) return;
          // Clear any previously-loaded rows so a failed search/reload shows
          // the error alone, never the stale (non-matching) table beneath it.
          setAccounts(null);
          setError(apiErrorMessage((e as Error).message));
          setLoading(false);
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, providerId, reloadNonce]);

  function setProviderFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("providerId", value);
    else next.delete("providerId");
    setSearchParams(next);
  }

  async function confirmSuspendToggle() {
    if (!confirming) return;
    setSuspendBusy(true);
    setSuspendError(null);
    try {
      await call("accounts.update", { userId: confirming.userId, suspended: !confirming.suspended });
      setConfirming(null);
      setReloadNonce((n) => n + 1); // refetch so the server-computed status badge updates
    } catch (e) {
      setSuspendError(apiErrorMessage((e as Error).message));
    } finally {
      setSuspendBusy(false);
    }
  }

  const columns: Column<Account>[] = [
    { key: "name", header: "Name" },
    ...(superAdmin
      ? ([{ key: "provider", header: "Provider", render: (a: Account) => a.providerName ?? "—" }] as Column<Account>[])
      : []),
    {
      key: "status",
      header: "Status",
      render: (a) => {
        const { text, tone } = statusLabel(a.status);
        return <Badge tone={tone}>{text}</Badge>;
      },
    },
    { key: "expiresAt", header: "Expiry", render: (a) => fmtDate(a.expiresAt) },
    { key: "devices", header: "Devices", render: (a) => `${a.devicesUsed}/${a.deviceLimit ?? "default"}` },
    {
      key: "actions",
      header: "",
      render: (a) => (
        <Button
          variant={a.suspended ? "secondary" : "danger"}
          onClick={(e) => {
            e.stopPropagation(); // don't trigger the row's navigate-to-detail
            setSuspendError(null);
            setConfirming(a);
          }}
        >
          {a.suspended ? "Unsuspend" : "Suspend"}
        </Button>
      ),
    },
  ];

  return (
    <div className="container">
      <div className="page-header">
        <h1>Accounts</h1>
        <Link to="/accounts/new" className="btn btn-primary">
          + New account
        </Link>
      </div>
      {superAdmin && providers.length > 0 && (
        <select
          className="search-input"
          value={providerId ?? ""}
          onChange={(e) => setProviderFilter(e.target.value)}
          aria-label="Filter by provider"
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {providerId && (
        <p className="muted">
          Filtered to one provider's accounts. <Link to="/accounts">Clear filter</Link>
        </p>
      )}
      <input
        type="search"
        className="search-input"
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search accounts"
      />
      {error && <p className="field-error">{error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && !error && accounts !== null && accounts.length === 0 && (
        <p>{search ? "No accounts match your search." : "No accounts yet."}</p>
      )}
      {!loading && !error && accounts !== null && accounts.length > 0 && (
        <Table
          columns={columns}
          rows={accounts}
          rowKey={(a) => a.userId}
          onRowClick={(a) => navigate(`/accounts/${a.userId}`)}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title={confirming.suspended ? "Unsuspend account" : "Suspend account"}
          message={
            confirming.suspended ? (
              <>
                Re-enable <strong>{confirming.name}</strong>? They will be able to sign in and play again.
              </>
            ) : (
              <>
                Suspend <strong>{confirming.name}</strong>? They will be signed out and blocked from playback until
                unsuspended.
              </>
            )
          }
          confirmLabel={confirming.suspended ? "Unsuspend" : "Suspend"}
          confirmVariant={confirming.suspended ? "primary" : "danger"}
          busy={suspendBusy}
          error={suspendError}
          onConfirm={confirmSuspendToggle}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
