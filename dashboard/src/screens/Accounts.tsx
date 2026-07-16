import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { statusLabel, fmtDate } from "../lib/format";
import { Badge, Table, type Column } from "../ui";

type Account = {
  userId: string;
  username: string;
  status: string;
  expiresAt: string | null;
  suspended: boolean;
  devicesUsed: number;
  deviceLimit: number;
  note: string | null;
};

const SEARCH_DEBOUNCE_MS = 300;

export default function Accounts() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      call<Account[]>("accounts.list", search ? { search } : {}).then(
        (rows) => {
          if (cancelled) return;
          setAccounts(rows);
          setLoading(false);
        },
        (e) => {
          if (cancelled) return;
          setError(apiErrorMessage((e as Error).message));
          setLoading(false);
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const columns: Column<Account>[] = [
    { key: "username", header: "Username" },
    {
      key: "status",
      header: "Status",
      render: (a) => {
        const { text, tone } = statusLabel(a.status);
        return <Badge tone={tone}>{text}</Badge>;
      },
    },
    { key: "expiresAt", header: "Expiry", render: (a) => fmtDate(a.expiresAt) },
    { key: "devices", header: "Devices", render: (a) => `${a.devicesUsed}/${a.deviceLimit}` },
  ];

  return (
    <div className="container">
      <div className="page-header">
        <h1>Accounts</h1>
        <Link to="/accounts/new" className="btn btn-primary">
          + New account
        </Link>
      </div>
      <input
        type="search"
        className="search-input"
        placeholder="Search by username…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search accounts"
      />
      {error && <p className="field-error">{error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && !error && accounts !== null && accounts.length === 0 && (
        <p>{search ? "No accounts match your search." : "No accounts yet."}</p>
      )}
      {!loading && accounts !== null && accounts.length > 0 && (
        <Table
          columns={columns}
          rows={accounts}
          rowKey={(a) => a.userId}
          onRowClick={(a) => navigate(`/accounts/${a.userId}`)}
        />
      )}
    </div>
  );
}
