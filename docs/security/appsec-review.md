# Application Security Review — Suvo

**Date:** 2026-07-17 · **Branch:** `feat/reseller-dashboard` · **Reviewer:** internal
**Method:** bounty-style — bias toward remotely-reachable, user-controlled attack paths; discard theoretical/local-only noise.

## Scope & methodology

**In scope (reviewed):**

- Supabase Edge Functions: `login`, `claim-device`, `data`, `admin`, and `_shared/*`.
- RLS policies and table grants (`supabase/migrations/**`, `supabase/sql/revoke_table_grants.sql`).
- Reseller dashboard client (`dashboard/src/**`) and its trust boundary (the `admin` function).
- Electron main process (`electron/**`): IPC bridge, navigation guards, VLC launch, `app://` file server.
- RN/web client surfaces touched by untrusted data (playlist/EPG/xtream metadata, trailers, deep links).

**Explicitly NOT reviewed (so silence ≠ coverage):** the Tizen/webOS native shells, third-party IPTV provider endpoints themselves, and the TMDB service. Native token-at-rest is covered as a finding, not a full mobile pentest.

**Severity scale:** Critical / High / Medium / Low / Info, each with a likelihood note. This is a first-party review, not an external submission, so the bar for "finding" includes accepted-risk dispositions.

## Headline

No new cross-tenant or remote-code vulnerability. The backend routes every table mutation through a `service_role` Edge Function that verifies the JWT and enforces authorization in pure, unit-tested modules before touching data. The one systemic weakness (P0-A) is a **business-control** bypass, contained by owner-scoped RLS, and already tracked with a staged fix.

## Backend findings (each: anchor + why it's safe/unsafe)

### Cleared attack classes

| Class | Anchor | Why cleared |
|---|---|---|
| SQL injection (CWE-89) | all functions use the supabase-js query builder; `claim_device` takes typed params (`20260702000002_device_limits.sql`) | Parameterized; no string-built SQL. |
| SSRF (CWE-918) | no Edge Function fetches a user-supplied URL | IPTV/M3U URLs are consumed by the *client* player, not the server. |
| Command injection (CWE-78) | `electron/vlcInvocation.js` | `execFile` (no shell) + URL scheme-validated to http(s) + args passed as a literal argv array, URL positioned after flags → no argument injection. |
| Path traversal (CWE-22) | `electron/appAssetPath.js` | `decodeURIComponent` runs before normalize; resolved path must `startsWith(root + sep)`; standard-scheme URL parser pre-collapses dot-segments. |
| XSS (CWE-79) | app + dashboard | Zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function`; React auto-escaping intact. |
| Auth bypass (CWE-287) | `_shared/deviceGate.ts::getUserId` + `config.toml` `verify_jwt` | JWT validated via GoTrue `getUser()`; `verify_jwt=true` on all functions except `login` (pre-auth by design). |
| Secrets | repo | No `service_role` key or private key in tracked files; `.env` gitignored; dashboard uses the anon key. |

### Access control (authorization)

- **data function** — every action is device-gated (`assertBoundDevice`) and JWT-scoped; per-row ops use `.eq("user_id", userId)`, and library ops (`history.*`/`favorites.*`) go through `assertOwnsUserKey` → `userKeyIsAuthorized`. No IDOR. **Cleared.**
- **admin function** — `canInvoke(caller, action)` gates every action (null caller → 403); per-account actions call `accountProviderId` + `canActOnAccount` (a provider may act only on accounts whose `provider_id` is their own; super-admin may act on any). Roles are hardcoded on create; the audit `actor_id` is server-set. **Cleared.**

## Live finding

### P0-A — device-gate bypass via direct PostgREST · **Medium** (likelihood: high; impact: low — no data breach)

The device gate lives only in the Edge Functions. A valid customer JWT can call PostgREST directly, bypassing it, because base-table grants for `authenticated` are still open on the 5 app tables.

**PoC:**

```bash
curl 'https://<project>.supabase.co/rest/v1/iptv_accounts?select=*' \
  -H 'apikey: <anon-key>' \
  -H 'Authorization: Bearer <a-valid-customer-JWT>'
# → 200, returns the caller's own iptv_accounts rows; the device gate is never consulted.
```

**Blast radius:** own rows only — RLS is owner-scoped (`auth.uid() = user_id`) on `iptv_accounts` / `watch_history` / `app_profiles`, and `favorites` was re-scoped in `20260716000001_rls_close_public_read.sql`. So this defeats the **device-limit / anti-account-sharing** control (a user can script access from unlimited devices with one JWT); it is **not** a cross-tenant read.

**Status:** tracked, staged fix. `supabase/sql/revoke_table_grants.sql` revokes the grants but is deliberately kept out of `migrations/` so `db push` cannot apply it before the functions-only client ships to every platform (applying early breaks current users).

**Verification of the fix (when applied):** re-run the PoC → expect `401 / permission denied`.

## Considered & cleared — client / mobile surface

| Surface | Anchor | Disposition |
|---|---|---|
| **Creds at rest (native)** | `src/services/supabase.js:15` (`storage: AsyncStorage`), `src/services/iptvApi.js:140` (`this.password`) | **Low/Info.** Supabase session (access+refresh JWT) and IPTV host/user/password persist in plaintext AsyncStorage. Requires a rooted/backed-up device. Fix path: move session + IPTV secrets to `expo-secure-store`. Tracked as SR-SECRET-10. |
| **TMDB key in bundle** | `src/services/tmdbApi.js:3` (`EXPO_PUBLIC_TMDB_API_KEY`) | **Info / accepted.** `EXPO_PUBLIC_*` is inlined into the shipped bundle and extractable. TMDB v3 keys are read-only public-catalog; remediation is rotate-only. No proxy warranted. |
| **CORS wildcard** | `supabase/functions/_shared/deviceGate.ts:10` (`ACAO: *`) | **Cleared.** Auth is a header-based Bearer token, not cookies, so `*` cannot be abused for credentialed cross-origin reads or CSRF. |
| **Login rate-limiting** | `supabase/functions/login/index.ts:29-34` | **Low / Plausible.** No app-layer throttle; relies on GoTrue. The server-side anon-client proxy may present one egress IP to GoTrue — confirm GoTrue rate-limits on `X-Forwarded-For`, not the function egress IP, else per-IP protection is weakened (or a global limit self-DoS's). |
| **Deep links** | `app.json:5` (`scheme: suvo`); no `getInitialURL`/`addEventListener('url')` in `src` | **Cleared.** Scheme registered but no inbound URL handler → no deep-link injection surface. |
| **Native trailer open** | `src/components/MovieDetail.jsx:135`, `src/components/SeriesDetail.jsx:231` (`Linking.openURL(trailer)`) | **Low.** Hands a TMDB-derived URL to the OS opener — same low trust boundary as the web trailer iframe. Consider asserting a `https://` + youtube host prefix. |
| **Refresh-token lifecycle** | `login/index.ts:48-49` returns tokens; `src/services/supabase.js:92` `setSession`, `:16-17` `autoRefreshToken`/`persistSession` | **Info.** Rotation is GoTrue-controlled (confirm enabled). Storage hardening tracked under SR-SECRET-10; TTL/replay tracked under SR-SESSION-12. |
| **EPG / channel-name rendering** | RN + react-native-web | **N/A.** Rendered as React text nodes (auto-escaped); no HTML sink. |

## Fixes landed alongside this review (2026-07-17)

- **Unbounded `entry` writes → capped.** `history.upsert` / `favorites.upsert` now validate `payload.entry` via `supabase/functions/_shared/entryLimits.js` (64 KiB byte cap + shape check) and return `INVALID_INPUT` 400 on violation. Closes the self-scoped storage-exhaustion vector (SR-INPUT-09) and turns a prior `payload.entry === undefined` 500 into a clean 400.
- **Agent-config hardening** — see [agent-config-scan.md](agent-config-scan.md).

## Deferred (needs design, not a blind edit)

- Native secrets-at-rest → `expo-secure-store` (SecureStore ~2 KB/key vs JWT size; existing-session migration; per-platform on-device verify).
- Server-side entitlement/expiry table — the root cause behind demo/G1 being only a client-side ceiling (SR-ENTITLE-14).
- `pgTAP` coverage for `claim_device` (race + revoke branches are currently unproven — SR-DEVLIM-08).
