import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { computeExpiresAt, fmtDate, statusLabel, type ExpiryChoice } from "../lib/format";
import { buildLinePayload, lineUpdateBlockedReason, type LineType } from "../lib/linePayload";
import { Badge, Button, Field, Modal, Table, type Column } from "../ui";

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
  username: string;
  email: string;
  status: string;
  expiresAt: string | null;
  suspended: boolean;
  note: string | null;
  deviceLimit: number | null;
  line: Line | null;
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
          <h1>{data.username}</h1>
          <Badge tone={status.tone}>{status.text}</Badge>{" "}
          <span className="muted">Expires {fmtDate(data.expiresAt)}</span>
        </div>
      </div>

      <SubscriptionCard data={data} userId={userId} onSaved={load} />
      <SecurityCard userId={userId} />
      <LineCard data={data} userId={userId} onSaved={load} />
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
  const [deviceLimitDraft, setDeviceLimitDraft] = useState(String(data.deviceLimit ?? 1));
  const [noteDraft, setNoteDraft] = useState(data.note ?? "");
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("1");
  const [customDate, setCustomDate] = useState("");

  const [savingDeviceLimit, setSavingDeviceLimit] = useState(false);
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [savingSuspend, setSavingSuspend] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDeviceLimitDraft(String(data.deviceLimit ?? 1));
    setNoteDraft(data.note ?? "");
  }, [data.deviceLimit, data.note]);

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
        <Field label="Device limit">
          <input
            type="number"
            min={1}
            step={1}
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
          onClick={() => run(setSavingSuspend, { suspended: !data.suspended })}
        >
          {savingSuspend ? "Saving…" : data.suspended ? "Unsuspend account" : "Suspend account"}
        </Button>
      </div>

      <div className="card-row">
        <Field label="Note">
          <textarea rows={2} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
        </Field>
        <Button disabled={savingNote} onClick={() => run(setSavingNote, { note: noteDraft.trim() || null })}>
          {savingNote ? "Saving…" : "Save note"}
        </Button>
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

function LineCard({
  data,
  userId,
  onSaved,
}: {
  data: AccountDetailData;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const line = data.line;
  const [lineType, setLineType] = useState<LineType>(line?.type ?? "xtream");
  const [host, setHost] = useState(line?.host ?? "");
  const [lineUsername, setLineUsername] = useState(line?.username ?? "");
  const [linePassword, setLinePassword] = useState("");
  const [url, setUrl] = useState(line?.url ?? "");
  const [nickname, setNickname] = useState(line?.nickname ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLineType(line?.type ?? "xtream");
    setHost(line?.host ?? "");
    setLineUsername(line?.username ?? "");
    setLinePassword("");
    setUrl(line?.url ?? "");
    setNickname(line?.nickname ?? "");
  }, [line?.type, line?.host, line?.username, line?.url, line?.nickname]);

  const blockedReason = lineUpdateBlockedReason(lineType, linePassword);

  async function handleSave() {
    if (blockedReason) return;
    setSaving(true);
    setError(null);
    try {
      const payload = buildLinePayload(lineType, { host, lineUsername, linePassword, url, nickname });
      await call("accounts.updateLine", { userId, line: payload });
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>IPTV line</h2>
      {error && <p className="field-error">{error}</p>}
      <div className="btn-row">
        <Button type="button" variant={lineType === "xtream" ? "primary" : "secondary"} onClick={() => setLineType("xtream")}>
          Xtream
        </Button>
        <Button type="button" variant={lineType === "m3u" ? "primary" : "secondary"} onClick={() => setLineType("m3u")}>
          M3U
        </Button>
      </div>

      {lineType === "xtream" ? (
        <>
          <Field label="Host">
            <input value={host} onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="Line username">
            <input value={lineUsername} onChange={(e) => setLineUsername(e.target.value)} />
          </Field>
          <Field label="Line password" error={blockedReason ?? undefined}>
            <input
              type="password"
              value={linePassword}
              onChange={(e) => setLinePassword(e.target.value)}
              placeholder="Re-enter to change"
            />
          </Field>
        </>
      ) : (
        <Field label="Playlist URL">
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
      )}
      <Field label="Nickname (optional)">
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </Field>

      <Button disabled={saving || !!blockedReason} onClick={handleSave}>
        {saving ? "Saving…" : "Save line"}
      </Button>
    </section>
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
            This permanently deletes <strong>{data.username}</strong> and all of its devices and history. Type the
            username to confirm.
          </p>
          <Field label="Username">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </Field>
          <div className="btn-row">
            <Button variant="danger" disabled={deleting || confirmText !== data.username} onClick={handleDelete}>
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
