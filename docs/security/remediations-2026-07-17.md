# Remediations — 2026-07-17 (reseller-dashboard security review)

Fixes applied on `feat/reseller-dashboard` after the `/ecc:security-review` of the
branch diff. Findings are described in [appsec-review.md](appsec-review.md); this
records what changed and what the owner must do to deploy each fix.

| Finding | Severity | Fix | Owner deploy step |
|---|---|---|---|
| Reseller gate bypass via public self-signup | HIGH | `enable_signup = false` in `[auth]` + `[auth.email]` (`supabase/config.toml`); registration UI removed from `src/screens/AuthScreen.jsx` | **Confirm hosted Auth "Allow new users to sign up" is OFF** (done). Push config. |
| `login` blunts GoTrue per-IP brute-force protection | MEDIUM | Postgres fixed-window throttle keyed on client IP **and** target email; wired into `login` before the password check, **fail-open** | Apply migration `20260717000002_login_rate_limit.sql`; redeploy `login`. |
| `accounts.list` / `providers.list` unbounded + N+1 | LOW/MED | Per-account query loops replaced with batched, chunked `.in(...)` lookups (constant query count); `providers.list` uses a grouped-count RPC; optional `limit`/`offset` added (default behavior unchanged) | Apply migration `20260717000003_provider_account_counts.sql`; redeploy `admin`. |
| Dashboard: tokens in localStorage, no CSP | LOW | `dashboard/public/_headers` (strict CSP + `frame-ancestors 'none'` / XFO / nosniff / HSTS); mirrored in `vite preview` (`dashboard/vite.config.ts`) | Ensure the host actually sends these headers. Verify with `npm run build && npm run preview` — if the built bundle emits an inline bootstrap script, add its hash to `script-src` (don't add `'unsafe-inline'`). |

## Notes

- **Fail-open throttle:** `login` only blocks on an explicit `allowed === false`
  from `hit_login_rate_limit`. If the migration is not yet deployed the RPC errors
  and login proceeds — deploy the migration *before or with* the `login` redeploy.
- **`provider_account_counts` deploy order:** until the RPC exists, `providers.list`
  shows `accounts_used: 0` for all providers (it degrades gracefully rather than
  failing). Deploy migration `…000003` with the `admin` redeploy.
- **Limits:** IP 30 / 5 min (mirrors GoTrue's stock per-IP), email 10 / 5 min
  (the tighter, IP-rotation-resistant key). Tune in
  `supabase/functions/_shared/loginRateLimit.js`.
- **Reviewed OK (no change):** CSRF N/A (bearer-header auth, not cookies);
  provider isolation / IDOR fail-closed; credential hygiene (passwords never
  returned, audit meta scrubbed); atomic account-create rollback; kill-switch on
  every data op; parameterized queries throughout; no committed secrets.
