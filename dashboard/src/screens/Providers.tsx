import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { useAuth } from "../auth";
import { supabase } from "../supabase";
import { fmtDate } from "../lib/format";
import { Badge, Button, ConfirmDialog, Field, Modal, Table, type Column } from "../ui";

type Provider = {
  user_id: string;
  role: string;
  name: string;
  max_accounts: number;
  suspended: boolean;
  created_at: string;
  accounts_used: number;
};

export default function Providers() {
  const { refresh } = useAuth();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [suspending, setSuspending] = useState<Provider | null>(null);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await call<Provider[]>("providers.list");
      // providers.list returns every row in the `providers` table, including
      // the caller's own super-admin identity row — and providers.delete has
      // no role guard server-side. Filter to actual providers so this screen
      // can never render a live Delete/Edit control over a super-admin row.
      setProviders(rows.filter((p) => p.role === "provider"));
    } catch (e) {
      setProviders(null);
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    supabase.auth.getSession().then(({ data }) => setSelfId(data.session?.user.id ?? null));
  }, [load]);

  async function afterSave(targetUserId: string) {
    await load();
    if (selfId && targetUserId === selfId) refresh();
  }

  async function confirmProviderSuspend() {
    if (!suspending) return;
    setSuspendBusy(true);
    setSuspendError(null);
    try {
      const id = suspending.user_id;
      await call("providers.update", { userId: id, suspended: !suspending.suspended });
      setSuspending(null);
      await afterSave(id);
    } catch (e) {
      setSuspendError(apiErrorMessage((e as Error).message));
    } finally {
      setSuspendBusy(false);
    }
  }

  const columns: Column<Provider>[] = [
    { key: "name", header: "Name", render: (p) => <Link to={`/accounts?providerId=${p.user_id}`}>{p.name}</Link> },
    { key: "accounts", header: "Accounts", render: (p) => `${p.accounts_used}/${p.max_accounts}` },
    {
      key: "suspended",
      header: "Status",
      render: (p) => (p.suspended ? <Badge tone="bad">Suspended</Badge> : <Badge tone="ok">Active</Badge>),
    },
    { key: "created_at", header: "Created", render: (p) => fmtDate(p.created_at) },
    {
      key: "actions",
      header: "",
      render: (p) => (
        <div className="btn-row">
          <Button variant="secondary" onClick={() => setEditing(p)}>
            Edit
          </Button>
          <Button
            variant={p.suspended ? "secondary" : "danger"}
            onClick={() => {
              setSuspendError(null);
              setSuspending(p);
            }}
          >
            {p.suspended ? "Unsuspend" : "Suspend"}
          </Button>
          <Button variant="danger" onClick={() => setDeleting(p)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="container">
      <div className="page-header">
        <h1>Providers</h1>
        <Button onClick={() => setCreating(true)}>+ New provider</Button>
      </div>

      {error && <p className="field-error">{error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && !error && providers !== null && providers.length === 0 && <p>No providers yet.</p>}
      {!loading && !error && providers !== null && providers.length > 0 && (
        <Table columns={columns} rows={providers} rowKey={(p) => p.user_id} />
      )}

      {creating && <CreateProviderModal onClose={() => setCreating(false)} onCreated={() => load()} />}
      {editing && (
        <EditProviderModal
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await afterSave(editing.user_id);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <DeleteProviderModal
          provider={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await load();
          }}
        />
      )}
      {suspending && (
        <ConfirmDialog
          title={suspending.suspended ? "Unsuspend provider" : "Suspend provider"}
          message={
            suspending.suspended ? (
              <>
                Re-enable <strong>{suspending.name}</strong>? The provider and all of their customer accounts regain
                access.
              </>
            ) : (
              <>
                Suspend <strong>{suspending.name}</strong>? This blocks the provider <em>and all of their customer
                accounts</em> from signing in and playing until unsuspended.
              </>
            )
          }
          confirmLabel={suspending.suspended ? "Unsuspend" : "Suspend"}
          confirmVariant={suspending.suspended ? "primary" : "danger"}
          busy={suspendBusy}
          error={suspendError}
          onConfirm={confirmProviderSuspend}
          onCancel={() => setSuspending(null)}
        />
      )}
    </div>
  );
}

function CreateProviderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [maxAccounts, setMaxAccounts] = useState("10");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call("providers.create", {
        email: email.trim(),
        password,
        name: name.trim(),
        maxAccounts: Number(maxAccounts),
      });
      onCreated();
      onClose();
    } catch (e2) {
      setError(apiErrorMessage((e2 as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New provider" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <p className="field-error">{error}</p>}
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Max accounts">
          <input type="number" min={0} step={1} value={maxAccounts} onChange={(e) => setMaxAccounts(e.target.value)} required />
        </Field>
        <div className="btn-row">
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create provider"}
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditProviderModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: Provider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(provider.name);
  const [maxAccounts, setMaxAccounts] = useState(String(provider.max_accounts));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call("providers.update", {
        userId: provider.user_id,
        name: name.trim(),
        maxAccounts: Number(maxAccounts),
      });
      onSaved();
    } catch (e2) {
      setError(apiErrorMessage((e2 as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Edit ${provider.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <p className="field-error">{error}</p>}
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Max accounts">
          <input type="number" min={0} step={1} value={maxAccounts} onChange={(e) => setMaxAccounts(e.target.value)} required />
        </Field>
        <div className="btn-row">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteProviderModal({
  provider,
  onClose,
  onDeleted,
}: {
  provider: Provider;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await call("providers.delete", { userId: provider.user_id });
      onDeleted();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete provider" onClose={onClose}>
      {error && <p className="field-error">{error}</p>}
      <p>
        Delete <strong>{provider.name}</strong>? This cannot be undone.
      </p>
      <div className="btn-row">
        <Button variant="danger" disabled={busy} onClick={handleDelete}>
          {busy ? "Deleting…" : "Delete provider"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
