import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { computeExpiresAt, type ExpiryChoice } from "../lib/format";
import { buildLinesPayload, isEmptyLineForm, type LineForm, type LineType } from "../lib/linePayload";
import { Button, Field } from "../ui";

const EXPIRY_PRESETS: { choice: ExpiryChoice; label: string }[] = [
  { choice: "1", label: "1 month" },
  { choice: "3", label: "3 months" },
  { choice: "6", label: "6 months" },
  { choice: "12", label: "12 months" },
];

export default function CreateAccount() {
  const navigate = useNavigate();

  // Account fields.
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [deviceLimit, setDeviceLimit] = useState("1");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");

  // Expiry picker.
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("1");
  const [customDate, setCustomDate] = useState("");

  // IPTV lines.
  const emptyLine = (): LineForm => ({ type: "xtream", host: "", lineUsername: "", linePassword: "", url: "", nickname: "" });
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [allowSelfLines, setAllowSelfLines] = useState(false);

  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() { setLines((prev) => [...prev, emptyLine()]); }
  // Keep at least one line normally; when the customer can add their own,
  // allow clearing every line so the account can be created with none.
  function removeLine(i: number) { setLines((prev) => (prev.length > 1 || allowSelfLines ? prev.filter((_, idx) => idx !== i) : prev)); }

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  // On success we show a confirmation with the resolved login email (which the
  // server auto-generates when Email is left blank) instead of navigating away,
  // so the provider can copy it and hand it to the customer to sign in.
  const [created, setCreated] = useState<{ userId: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function fieldError(name: string, hint: string): string | undefined {
    return invalidFields.includes(name) ? hint : undefined;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInvalidFields([]);
    try {
      const expiresAt = computeExpiresAt(expiryChoice, customDate);
      const payload = {
        name: name.trim(),
        password,
        deviceLimit: Number(deviceLimit),
        expiresAt,
        note: note.trim() || undefined,
        email: email.trim() || undefined,
        // Drop untouched rows so a blank line isn't sent as an invalid one.
        // When allowSelfLines is on this can legitimately be an empty array —
        // the customer will add their own line in the app.
        lines: buildLinesPayload(lines.filter((l) => !isEmptyLineForm(l))),
        allowSelfLines,
      };
      const result = await call<{ userId: string; email?: string }>("accounts.create", payload);
      // Show the copyable login email when the server returns it. Tolerate a
      // server that predates this field (deploy skew): fall back to the account
      // detail page, which loads and displays the same email.
      if (result.email) setCreated({ userId: result.userId, email: result.email });
      else navigate(`/accounts/${result.userId}`);
    } catch (err) {
      const e2 = err as Error & { fields?: string[] };
      setError(apiErrorMessage(e2.message));
      setInvalidFields(e2.fields ?? []);
    } finally {
      setSubmitting(false);
    }
  }

  const lineInvalid = invalidFields.includes("lines");

  // Clear every field back to defaults so "Create another" starts fresh.
  function reset() {
    setName("");
    setPassword("");
    setDeviceLimit("1");
    setNote("");
    setEmail("");
    setExpiryChoice("1");
    setCustomDate("");
    setLines([emptyLine()]);
    setAllowSelfLines(false);
    setError(null);
    setInvalidFields([]);
    setCopied(false);
    setCreated(null);
  }

  if (created) {
    return (
      <div className="container">
        <h1>Account created</h1>
        <section className="card">
          <p>Give the customer this login email and the password you set — they sign in with the email, not a username.</p>
          <div className="card-row">
            <Field label="Login email">
              <input value={created.email} readOnly onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(created.email);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="btn-row">
            <Button onClick={() => navigate(`/accounts/${created.userId}`)}>View account</Button>
            <Button variant="secondary" onClick={reset}>Create another</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Create account</h1>
      <form onSubmit={handleSubmit}>
        {error && <p className="field-error">{error}</p>}

        <Field label="Name" error={fieldError("name", "Name is required (max 60 characters).")}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            required
            maxLength={60}
          />
        </Field>

        <Field label="Password" error={fieldError("password", "Must be at least 6 characters.")}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
          />
        </Field>

        <Field label="Device limit" error={fieldError("deviceLimit", "Must be a whole number, 1 or more.")}>
          <input
            type="number"
            min={1}
            step={1}
            value={deviceLimit}
            onChange={(e) => setDeviceLimit(e.target.value)}
            required
          />
        </Field>

        <Field label="Email (optional — a login email is auto-generated if left blank)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>

        <Field label="Note (optional)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>

        <fieldset className="field-group">
          <legend>Expiry {fieldError("expiresAt", "That date isn't valid.") && <span className="field-error">— invalid date</span>}</legend>
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
            <Button
              type="button"
              variant={expiryChoice === "never" ? "primary" : "secondary"}
              onClick={() => setExpiryChoice("never")}
            >
              No expiry
            </Button>
          </div>
          {expiryChoice === "custom" && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              required
              className="date-input"
            />
          )}
        </fieldset>

        <div className="card-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={allowSelfLines} onChange={(e) => setAllowSelfLines(e.target.checked)} />
            Allow this customer to add their own IPTV lines in the app
          </label>
        </div>
        {allowSelfLines && (
          <p className="muted">Adding a line below is optional — the customer can add their own in the app.</p>
        )}

        {lines.map((ln, i) => (
          <fieldset className="field-group" key={i}>
            <legend>
              IPTV line {i + 1}{allowSelfLines && " (optional)"}
              {lineInvalid && <span className="field-error"> — check the fields below</span>}
            </legend>
            <div className="btn-row">
              <Button type="button" variant={ln.type === "xtream" ? "primary" : "secondary"} onClick={() => updateLine(i, { type: "xtream" })}>Xtream</Button>
              <Button type="button" variant={ln.type === "m3u" ? "primary" : "secondary"} onClick={() => updateLine(i, { type: "m3u" })}>M3U</Button>
              {(lines.length > 1 || allowSelfLines) && (
                <Button type="button" variant="danger" onClick={() => removeLine(i)}>Remove line</Button>
              )}
            </div>
            {ln.type === "xtream" ? (
              <>
                <Field label="Host"><input value={ln.host} onChange={(e) => updateLine(i, { host: e.target.value })} required={!allowSelfLines} /></Field>
                <Field label="Line username"><input value={ln.lineUsername} onChange={(e) => updateLine(i, { lineUsername: e.target.value })} required={!allowSelfLines} /></Field>
                <Field label="Line password"><input type="password" value={ln.linePassword} onChange={(e) => updateLine(i, { linePassword: e.target.value })} required={!allowSelfLines} /></Field>
              </>
            ) : (
              <Field label="Playlist URL"><input type="url" value={ln.url} onChange={(e) => updateLine(i, { url: e.target.value })} placeholder="https://…" required={!allowSelfLines} /></Field>
            )}
            <Field label="Nickname (optional)"><input value={ln.nickname} onChange={(e) => updateLine(i, { nickname: e.target.value })} /></Field>
          </fieldset>
        ))}
        <Button type="button" variant="secondary" onClick={addLine}>Add another line</Button>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
