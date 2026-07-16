import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { computeExpiresAt, type ExpiryChoice } from "../lib/format";
import { buildLinePayload, type LineType } from "../lib/linePayload";
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceLimit, setDeviceLimit] = useState("1");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");

  // Expiry picker.
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("1");
  const [customDate, setCustomDate] = useState("");

  // IPTV line.
  const [lineType, setLineType] = useState<LineType>("xtream");
  const [host, setHost] = useState("");
  const [lineUsername, setLineUsername] = useState("");
  const [linePassword, setLinePassword] = useState("");
  const [url, setUrl] = useState("");
  const [nickname, setNickname] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);

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
      const line = buildLinePayload(lineType, { host, lineUsername, linePassword, url, nickname });
      const payload = {
        username: username.trim(),
        password,
        deviceLimit: Number(deviceLimit),
        expiresAt,
        note: note.trim() || undefined,
        email: email.trim() || undefined,
        line,
      };
      const result = await call<{ userId: string }>("accounts.create", payload);
      navigate(`/accounts/${result.userId}`);
    } catch (err) {
      const e2 = err as Error & { fields?: string[] };
      setError(apiErrorMessage(e2.message));
      setInvalidFields(e2.fields ?? []);
    } finally {
      setSubmitting(false);
    }
  }

  const lineInvalid = invalidFields.includes("line");

  return (
    <div className="container">
      <h1>Create account</h1>
      <form onSubmit={handleSubmit}>
        {error && <p className="field-error">{error}</p>}

        <Field label="Username" error={fieldError("username", "3-32 characters: letters, numbers, . _ -")}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            required
            minLength={3}
            maxLength={32}
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

        <Field label="Email (optional — auto-generated if left blank)">
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

        <fieldset className="field-group">
          <legend>
            IPTV line{lineInvalid && <span className="field-error"> — check the fields below</span>}
          </legend>
          <div className="btn-row">
            <Button
              type="button"
              variant={lineType === "xtream" ? "primary" : "secondary"}
              onClick={() => setLineType("xtream")}
            >
              Xtream
            </Button>
            <Button
              type="button"
              variant={lineType === "m3u" ? "primary" : "secondary"}
              onClick={() => setLineType("m3u")}
            >
              M3U
            </Button>
          </div>

          {lineType === "xtream" ? (
            <>
              <Field label="Host">
                <input value={host} onChange={(e) => setHost(e.target.value)} required className={lineInvalid ? "input-invalid" : undefined} />
              </Field>
              <Field label="Line username">
                <input value={lineUsername} onChange={(e) => setLineUsername(e.target.value)} required className={lineInvalid ? "input-invalid" : undefined} />
              </Field>
              <Field label="Line password">
                <input
                  type="password"
                  value={linePassword}
                  onChange={(e) => setLinePassword(e.target.value)}
                  required
                  className={lineInvalid ? "input-invalid" : undefined}
                />
              </Field>
            </>
          ) : (
            <Field label="Playlist URL">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                required
                className={lineInvalid ? "input-invalid" : undefined}
              />
            </Field>
          )}
          <Field label="Nickname (optional)">
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </Field>
        </fieldset>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
