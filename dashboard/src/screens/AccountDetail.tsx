import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { computeExpiresAt, fmtDate, statusLabel, type ExpiryChoice } from "../lib/format";
import { buildLinePayload, lineUpdateBlockedReason, type LineType } from "../lib/linePayload";
import { Badge, Button, ConfirmDialog, Field, Modal, Table, type Column } from "../ui";

type Line = {
  id: string;
  type: LineType;
  nickname: string | null;
  host: string | null;
  username: string | null;
  url: string | null;
};

type AccountDetailData = {
  userId: string;
  name: string;
  email: string;
  status: string;
  expiresAt: string | null;
  suspended: boolean;
  note: string | null;
  deviceLimit: number | null;
  allowSelfLines: boolean;
  lines: Line[];
};

type Device = {
  device_id: string;
  platform: string;
  label: string | null;
  bound_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
};

const EXPIRY_PRESETS: { choice: ExpiryChoice; label: string }[] = [
  { choice: "1", label: "+1 month" },
  { choice: "3", label: "+3 months" },
  { choice: "6", label: "+6 months" },
  { choice: "12", label: "+12 months" },
];

export default function AccountDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<AccountDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await call<AccountDetailData>("accounts.get", { userId });
      setData(result);
    } catch (e) {
      setLoadError(apiErrorMessage((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadDevices = useCallback(async () => {
    if (!userId) return;
    setDevicesError(null);
    try {
      const result = await call<Device[]>("devices.list", { userId });
      setDevices(result);
    } catch (e) {
      setDevices(null);
      setDevicesError(apiErrorMessage((e as Error).message));
    }
  }, [userId]);

  useEffect(() => {
    load();
    loadDevices();
  }, [load, loadDevices]);

  if (!userId) return null;
  if (loading) return <div className="container"><p>Loading…</p></div>;
  if (loadError) return <div className="container"><p className="field-error">{loadError}</p></div>;
  if (!data) return null;

  const status = statusLabel(data.status);

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>{data.name}</h1>
          <Badge tone={status.tone}>{status.text}</Badge>{" "}
          <span className="muted">Expires {fmtDate(data.expiresAt)}</span>
        </div>
      </div>

      <SubscriptionCard data={data} userId={userId} onSaved={load} />
      <SecurityCard userId={userId} />
      <LinesCard data={data} userId={userId} onSaved={load} />
      <DevicesCard devices={devices} devicesError={devicesError} userId={userId} onSaved={loadDevices} />
      <DangerZone data={data} userId={userId} onDeleted={() => navigate("/accounts")} />
    </div>
  );
}

function SubscriptionCard({
  data,
  userId,
  onSaved,
}: {
  data: AccountDetailData;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const [deviceLimitDraft, setDeviceLimitDraft] = useState(data.deviceLimit != null ? String(data.deviceLimit) : "");
  const [noteDraft, setNoteDraft] = useState(data.note ?? "");
  const [nameDraft, setNameDraft] = useState(data.name ?? "");
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("1");
  const [customDate, setCustomDate] = useState("");

  const [savingDeviceLimit, setSavingDeviceLimit] = useState(false);
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [savingSuspend, setSavingSuspend] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingSelfAdd, setSavingSelfAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  async function doSuspendToggle() {
    setSavingSuspend(true);
    setError(null);
    try {
      await call("accounts.update", { userId, suspended: !data.suspended });
      setConfirmSuspend(false);
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setSavingSuspend(false);
    }
  }

  useEffect(() => {
    // Null means "no override — using the account default"; show that as an
    // empty field with a "default" placeholder instead of a literal "1",
    // consistent with the "default" text Accounts.tsx renders for the same
    // null value in its Devices column.
    setDeviceLimitDraft(data.deviceLimit != null ? String(data.deviceLimit) : "");
    setNoteDraft(data.note ?? "");
    setNameDraft(data.name ?? "");
  }, [data.deviceLimit, data.note, data.name]);

  async function run(setBusy: (b: boolean) => void, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call("accounts.update", { userId, ...patch });
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Subscription</h2>
      {error && <p className="field-error">{error}</p>}

      <div className="card-row">
        <Field label="Login email">
          <input value={data.email} readOnly onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(data.email)}>
          Copy
        </Button>
      </div>

      <div className="card-row">
        <Field label="Name">
          <input value={nameDraft} maxLength={60} onChange={(e) => setNameDraft(e.target.value)} />
        </Field>
        <Button
          disabled={savingName || nameDraft.trim().length < 1}
          onClick={() => run(setSavingName, { name: nameDraft.trim() })}
        >
          {savingName ? "Saving…" : "Save name"}
        </Button>
      </div>

      <div className="card-row">
        <Field label="Device limit">
          <input
            type="number"
            min={1}
            step={1}
            placeholder="default"
            value={deviceLimitDraft}
            onChange={(e) => setDeviceLimitDraft(e.target.value)}
          />
        </Field>
        <Button
          disabled={savingDeviceLimit}
          onClick={() => run(setSavingDeviceLimit, { deviceLimit: Number(deviceLimitDraft) })}
        >
          {savingDeviceLimit ? "Saving…" : "Save limit"}
        </Button>
      </div>

      <fieldset className="field-group">
        <legend>Expiry</legend>
        <div className="btn-row">
          {EXPIRY_PRESETS.map((p) => (
            <Button
              key={p.choice}
              type="button"
              variant={expiryChoice === p.choice ? "primary" : "secondary"}
              onClick={() => setExpiryChoice(p.choice)}
            >
              {p.label}
            </Button>
          ))}
          <Button
            type="button"
            variant={expiryChoice === "custom" ? "primary" : "secondary"}
            onClick={() => setExpiryChoice("custom")}
          >
            Custom date
          </Button>
        </div>
        {expiryChoice === "custom" && (
          <input type="date" className="date-input" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
        )}
        <div className="btn-row">
          <Button
            // A "custom" choice with no date picked would otherwise resolve to
            // null via computeExpiresAt and silently clear the expiry instead
            // of doing nothing — block that rather than let it slip through.
            disabled={savingExpiry || (expiryChoice === "custom" && !customDate)}
            onClick={() => {
              // Anchor a preset renewal to the LATER of now vs. the current
              // expiry: pass the current expiry only when it's still in the
              // future. For an already-expired account, anchoring to the past
              // expiry would land "+N months" still in the past → a no-op
              // renewal. Passing undefined makes expiryPreset count from now.
              // (never/custom paths ignore the anchor entirely.)
              const anchor =
                data.expiresAt && Date.parse(data.expiresAt) > Date.now() ? data.expiresAt : undefined;
              run(setSavingExpiry, { expiresAt: computeExpiresAt(expiryChoice, customDate, anchor) });
            }}
          >
            {savingExpiry ? "Saving…" : "Renew"}
          </Button>
          <Button variant="secondary" disabled={savingExpiry} onClick={() => run(setSavingExpiry, { expiresAt: null })}>
            Clear (never expires)
          </Button>
        </div>
      </fieldset>

      <div className="card-row">
        <Button
          variant={data.suspended ? "secondary" : "danger"}
          disabled={savingSuspend}
          onClick={() => {
            setError(null);
            setConfirmSuspend(true);
          }}
        >
          {data.suspended ? "Unsuspend account" : "Suspend account"}
        </Button>
      </div>

      {confirmSuspend && (
        <ConfirmDialog
          title={data.suspended ? "Unsuspend account" : "Suspend account"}
          message={
            data.suspended ? (
              <>
                Re-enable <strong>{data.name}</strong>? They will be able to sign in and play again.
              </>
            ) : (
              <>
                Suspend <strong>{data.name}</strong>? They will be signed out and blocked from playback until
                unsuspended.
              </>
            )
          }
          confirmLabel={data.suspended ? "Unsuspend" : "Suspend"}
          confirmVariant={data.suspended ? "primary" : "danger"}
          busy={savingSuspend}
          error={error}
          onConfirm={doSuspendToggle}
          onCancel={() => setConfirmSuspend(false)}
        />
      )}

      <div className="card-row">
        <Field label="Note">
          <textarea rows={2} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
        </Field>
        <Button disabled={savingNote} onClick={() => run(setSavingNote, { note: noteDraft.trim() || null })}>
          {savingNote ? "Saving…" : "Save note"}
        </Button>
      </div>

      <div className="card-row">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={data.allowSelfLines}
            disabled={savingSelfAdd}
            onChange={() => run(setSavingSelfAdd, { allowSelfLines: !data.allowSelfLines })}
          />
          Allow this customer to add their own IPTV lines in the app
        </label>
      </div>
    </section>
  );
}

function SecurityCard({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function openModal() {
    setPassword("");
    setError(null);
    setDone(false);
    setOpen(true);
  }

  async function handleSetPassword() {
    setSaving(true);
    setError(null);
    try {
      await call("accounts.setPassword", { userId, password });
      setDone(true);
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>Security</h2>
      <Button variant="secondary" onClick={openModal}>
        Reset password
      </Button>
      {open && (
        <Modal title="Reset password" onClose={() => setOpen(false)}>
          {done ? (
            <>
              <p>Password updated.</p>
              <Button onClick={() => setOpen(false)}>Close</Button>
            </>
          ) : (
            <>
              {error && <p className="field-error">{error}</p>}
              <Field label="New password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                />
              </Field>
              <div className="btn-row">
                <Button disabled={saving || password.length < 6} onClick={handleSetPassword}>
                  {saving ? "Saving…" : "Set password"}
                </Button>
                <Button variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}

function LinesCard({
  data,
  userId,
  onSaved,
}: {
  data: AccountDetailData;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Line | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await call("accounts.deleteLine", { userId, lineId: removing.id });
      setRemoving(null);
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>IPTV lines</h2>
      {error && <p className="field-error">{error}</p>}

      {data.lines.length === 0 && <p>No lines yet.</p>}
      {data.lines.map((ln) =>
        editingId === ln.id ? (
          <LineEditor
            key={ln.id}
            line={ln}
            onCancel={() => setEditingId(null)}
            onSubmit={async (payload) => {
              await call("accounts.updateLine", { userId, lineId: ln.id, line: payload });
              setEditingId(null);
              await onSaved();
            }}
          />
        ) : (
          <div className="card-row" key={ln.id}>
            <div style={{ flex: 1 }}>
              <strong>{ln.nickname || ln.host || ln.url || ln.type}</strong>{" "}
              <span className="muted">
                {ln.type === "m3u" ? ln.url : `${ln.username ?? ""}@${ln.host ?? ""}`}
              </span>
            </div>
            <Button variant="secondary" onClick={() => { setAdding(false); setEditingId(ln.id); }}>Edit</Button>
            <Button variant="danger" disabled={busy} onClick={() => setRemoving(ln)}>Delete</Button>
          </div>
        ),
      )}

      {adding ? (
        <LineEditor
          onCancel={() => setAdding(false)}
          onSubmit={async (payload) => {
            await call("accounts.addLine", { userId, line: payload });
            setAdding(false);
            await onSaved();
          }}
        />
      ) : (
        <Button onClick={() => { setEditingId(null); setAdding(true); }}>Add line</Button>
      )}

      {removing && (
        <Modal title="Delete line" onClose={() => setRemoving(null)}>
          <p>
            Delete line <strong>{removing.nickname || removing.host || removing.url}</strong>? This can't be undone.
          </p>
          <div className="btn-row">
            <Button variant="danger" disabled={busy} onClick={confirmRemove}>
              {busy ? "Deleting…" : "Delete line"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// Add/edit a single line. For an existing xtream line the password must be
// re-entered to save (the server never returns it) — same rule as before,
// enforced via lineUpdateBlockedReason.
function LineEditor({
  line,
  onSubmit,
  onCancel,
}: {
  line?: Line;
  onSubmit: (payload: ReturnType<typeof buildLinePayload>) => Promise<void>;
  onCancel: () => void;
}) {
  const [lineType, setLineType] = useState<LineType>(line?.type ?? "xtream");
  const [host, setHost] = useState(line?.host ?? "");
  const [lineUsername, setLineUsername] = useState(line?.username ?? "");
  const [linePassword, setLinePassword] = useState("");
  const [url, setUrl] = useState(line?.url ?? "");
  const [nickname, setNickname] = useState(line?.nickname ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adding a brand-new line requires a password (no existing secret to keep);
  // editing an xtream line also requires re-entry. Both reduce to "xtream needs
  // a password in the box".
  const blockedReason = lineUpdateBlockedReason(lineType, linePassword);

  async function handleSave() {
    if (blockedReason) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(buildLinePayload(lineType, { host, lineUsername, linePassword, url, nickname }));
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="field-group">
      <legend>{line ? "Edit line" : "New line"}</legend>
      {error && <p className="field-error">{error}</p>}
      <div className="btn-row">
        <Button type="button" variant={lineType === "xtream" ? "primary" : "secondary"} onClick={() => setLineType("xtream")}>Xtream</Button>
        <Button type="button" variant={lineType === "m3u" ? "primary" : "secondary"} onClick={() => setLineType("m3u")}>M3U</Button>
      </div>
      {lineType === "xtream" ? (
        <>
          <Field label="Host"><input value={host} onChange={(e) => setHost(e.target.value)} /></Field>
          <Field label="Line username"><input value={lineUsername} onChange={(e) => setLineUsername(e.target.value)} /></Field>
          <Field label="Line password" error={blockedReason ?? undefined}>
            <input type="password" value={linePassword} onChange={(e) => setLinePassword(e.target.value)} placeholder={line ? "Re-enter to change" : ""} />
          </Field>
        </>
      ) : (
        <Field label="Playlist URL"><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
      )}
      <Field label="Nickname (optional)"><input value={nickname} onChange={(e) => setNickname(e.target.value)} /></Field>
      <div className="btn-row">
        <Button disabled={saving || !!blockedReason} onClick={handleSave}>{saving ? "Saving…" : "Save line"}</Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </fieldset>
  );
}

function DevicesCard({
  devices,
  devicesError,
  userId,
  onSaved,
}: {
  devices: Device[] | null;
  devicesError: string | null;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Device | null>(null);

  async function toggleRevoke(device: Device) {
    setBusyDeviceId(device.device_id);
    setError(null);
    try {
      const action = device.revoked_at ? "devices.unrevoke" : "devices.revoke";
      await call(action, { userId, deviceId: device.device_id });
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setBusyDeviceId(null);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusyDeviceId(removing.device_id);
    setError(null);
    try {
      await call("devices.remove", { userId, deviceId: removing.device_id });
      setRemoving(null);
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setBusyDeviceId(null);
    }
  }

  const columns: Column<Device>[] = [
    { key: "platform", header: "Platform" },
    { key: "label", header: "Label", render: (d) => d.label ?? "—" },
    { key: "bound_at", header: "Bound", render: (d) => fmtDate(d.bound_at) },
    { key: "last_seen_at", header: "Last seen", render: (d) => fmtDate(d.last_seen_at) },
    {
      key: "status",
      header: "Status",
      render: (d) => (d.revoked_at ? <Badge tone="bad">Revoked</Badge> : <Badge tone="ok">Active</Badge>),
    },
    {
      key: "actions",
      header: "",
      render: (d) => (
        <div className="btn-row">
          <Button variant="secondary" disabled={busyDeviceId === d.device_id} onClick={() => toggleRevoke(d)}>
            {d.revoked_at ? "Re-enable" : "Revoke"}
          </Button>
          <Button variant="danger" disabled={busyDeviceId === d.device_id} onClick={() => setRemoving(d)}>
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className="card">
      <h2>Devices</h2>
      {error && <p className="field-error">{error}</p>}
      {devicesError && <p className="field-error">{devicesError}</p>}
      {devices === null && !devicesError && <p>Loading…</p>}
      {devices !== null && devices.length === 0 && <p>No devices bound yet.</p>}
      {devices !== null && devices.length > 0 && <Table columns={columns} rows={devices} rowKey={(d) => d.device_id} />}

      {removing && (
        <Modal title="Remove device" onClose={() => setRemoving(null)}>
          <p>
            Remove <strong>{removing.label ?? removing.device_id}</strong>? This frees a device slot; the device will
            need to bind again to reconnect.
          </p>
          <div className="btn-row">
            <Button variant="danger" disabled={busyDeviceId === removing.device_id} onClick={confirmRemove}>
              {busyDeviceId === removing.device_id ? "Removing…" : "Remove device"}
            </Button>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function DangerZone({
  data,
  userId,
  onDeleted,
}: {
  data: AccountDetailData;
  userId: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setConfirmText("");
    setError(null);
    setOpen(true);
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await call("accounts.delete", { userId });
      onDeleted();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
      setDeleting(false);
    }
  }

  return (
    <section className="card card-danger">
      <h2>Danger zone</h2>
      <Button variant="danger" onClick={openModal}>
        Delete account
      </Button>
      {open && (
        <Modal title="Delete account" onClose={() => setOpen(false)}>
          {error && <p className="field-error">{error}</p>}
          <p>
            This permanently deletes <strong>{data.name}</strong> and all of its devices and history. Type the
            name to confirm.
          </p>
          <Field label="Name">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </Field>
          <div className="btn-row">
            <Button variant="danger" disabled={deleting || confirmText !== data.name} onClick={handleDelete}>
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
            <Button variant="secondary" disabled={deleting} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
