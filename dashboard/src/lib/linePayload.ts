// Pure builder for the `line` object the admin API expects on
// accounts.create / accounts.updateLine. Kept side-effect-free so both
// CreateAccount and AccountDetail can share it and it can be unit-tested
// without a DOM.
export type LineType = "xtream" | "m3u";

// Raw values straight out of form state. Named distinctly from the account's
// own username/password fields to avoid confusing the two in call sites.
export type LineFormFields = {
  host: string;
  lineUsername: string;
  linePassword: string;
  url: string;
  nickname: string;
};

// Matches the API contract verbatim: line:{type,host,username,password,url,nickname}.
// Always includes every key (null for whichever half doesn't apply) so the
// shape is uniform regardless of `type`.
export type LinePayload = {
  type: LineType;
  host: string | null;
  username: string | null;
  password: string | null;
  url: string | null;
  nickname: string | null;
};

export function buildLinePayload(type: LineType, fields: LineFormFields): LinePayload {
  const nickname = fields.nickname.trim() ? fields.nickname.trim() : null;
  if (type === "m3u") {
    return { type: "m3u", host: null, username: null, password: null, url: fields.url.trim(), nickname };
  }
  return {
    type: "xtream",
    host: fields.host.trim(),
    username: fields.lineUsername.trim(),
    password: fields.linePassword,
    url: null,
    nickname,
  };
}

// The backend's validateLine has no partial-update path: for an xtream line it
// requires a non-empty password on every write (accounts.updateLine included),
// because passwords are never round-tripped back to the client on reads. So
// "leave password blank to keep it unchanged" (natural for the other fields)
// is not something the server supports for xtream — re-entering the password
// is required to save ANY change to an xtream line. This checks that
// client-side so we can block the doomed submit with a clear, specific
// message instead of firing it and getting back a generic INVALID_INPUT.
export function lineUpdateBlockedReason(type: LineType, linePassword: string): string | null {
  if (type === "xtream" && !linePassword.trim()) {
    return "Re-enter the password to save changes to this line — Suvo never stores or returns it.";
  }
  return null;
}

// One line's full form state (type + the raw fields). Used by the multi-line
// editors in CreateAccount and AccountDetail.
export type LineForm = { type: LineType } & LineFormFields;

export function buildLinesPayload(forms: LineForm[]): LinePayload[] {
  return forms.map((f) => buildLinePayload(f.type, f));
}
