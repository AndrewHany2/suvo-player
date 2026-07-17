# Security Requirements — Suvo

**Living document.** Last updated 2026-07-17. Each requirement is an atomic `SHALL` statement, traced up to a threat/attacker-goal and down to a control + a test anchor + an observable acceptance condition. Verification status is first-class so that unit-tested, manual-review, and untested requirements are visibly distinct.

## Record schema

```
ID            SR-<area>-<n>              stable
Statement     "The system SHALL …"       atomic, testable (no "be secure")
Type          Functional | Non-functional | Constraint
Threat        G1|G2|G3|G4 (+ STRIDE)     attacker goal it defeats
Priority      P0 | P1 | P2
Risk          Critical | High | Medium | Low   (likelihood × impact)
Enforced-by   file:symbol                the control
Verification  test-anchor | manual-review | integration-gap
Acceptance    definition-of-done         observable pass condition
Status        Holds | Partial | Gap
```

**Attacker goals:** G1 bypass time-limited demo · G2 defeat one-device license (account sharing) · G3 extract secrets/creds · G4 repackage & redistribute.

## Requirement register (R1–R8, recast)

| ID | SHALL | Type | Threat | Pri | Risk | Enforced-by | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| SR-AUTHN-01 | Authenticate the caller server-side before any privileged data access | Func | G3 | P0 | High | `_shared/deviceGate.ts::getUserId` (GoTrue `getUser()`) + `config.toml verify_jwt` | **manual-review** | Holds |
| SR-AUTHZ-02 | Reject any library read/write whose `user_key` is not the caller's own id or an app_profile they own | Func | G3 (IDOR) | P0 | High | `deviceGate.ts::assertOwnsUserKey`→`authz.js::userKeyIsAuthorized` | `authz.test.js` (6 cases incl. IDOR) | Holds |
| SR-AUTHZ-03 | A provider SHALL act only on accounts they own; super-admin on any | Func | G3 | P0 | High | `adminLogic.js::canActOnAccount` + `admin/index.ts::accountProviderId` | `adminLogic.test.js::canActOnAccount` | Holds |
| SR-AUTHZ-04 | Provider-management actions SHALL be super-admin only | Func | G3 | P1 | Med | `adminLogic.js::canInvoke` (`SUPER_ADMIN_ACTIONS`) | `adminLogic.test.js::canInvoke` | Holds |
| SR-STATUS-05 | Suspended/expired accounts (and those under a suspended provider) SHALL be denied | Func | — | P1 | Med | `accountStatus.js` + `deviceGate.ts::assertAccountActive` | `accountStatus.test.js` (8 cases) | Holds |
| SR-LOGIN-06 | Login SHALL NOT enable email enumeration | Non-func | G3 | P1 | Med | `loginLogic.js` (generic `INVALID_CREDENTIALS`) + `20260716000001_rls_close_public_read.sql` | `loginLogic.test.js` | Holds |
| SR-AUDIT-07 | The audit actor SHALL be non-spoofable (server-set `actor_id`) | Func | G3 | P2 | Low | `admin/index.ts::audit` (`actor_id = userId`) | **manual-review** | Holds |
| SR-DEVLIM-08 | Device count SHALL be enforced server-side, race-safely, incl. revoke | Func | G2 | P0 | Critical | `claim_device` SQL + `deviceGate.ts::assertBoundDevice` | **integration-gap** | **Partial** |

### Worked record — SR-AUTHZ-02

```
Statement    The data Edge Function SHALL reject any watch_history/favorites read or
             write whose client-supplied user_key is not the caller's own auth id or an
             app_profile the caller owns.
Type         Functional
Threat       G3 — cross-tenant IDOR; STRIDE: Information Disclosure / Elevation
Priority     P0   Risk High (service_role bypasses RLS → a wrong user_key = full cross-account read)
Enforced-by  supabase/functions/_shared/deviceGate.ts::assertOwnsUserKey
             → supabase/functions/_shared/authz.js::userKeyIsAuthorized
             (called in data/index.ts on history.{fetch,upsert,delete} + favorites.*)
Verification supabase/functions/_shared/authz.test.js
             ::"denies an app_profile owned by another user (the IDOR attack)" (+5 siblings)
Acceptance   Given caller user-1 and userKey=profile-9 owned by user-2, the call throws
             FORBIDDEN (403) and no row is returned or written.
Status       Holds (pure decision unit-tested; the Deno wiring itself is manual-review).
```

### Worked record — SR-DEVLIM-08

```
Statement    The account's device count SHALL be enforced server-side: a claim beyond the
             per-account limit, or a revoked binding, SHALL be denied race-safely, and no
             data op SHALL succeed for an unbound/revoked device.
Type         Functional
Threat       G2 — defeat one-device license / account sharing; STRIDE: Elevation
Priority     P0   Risk Critical (this IS the paid-license boundary)
Enforced-by  public.claim_device() (advisory lock + count<limit) in
             20260702000002_device_limits.sql, made revoke-aware in 20260715000001_device_revoke.sql;
             per-op gate deviceGate.ts::assertBoundDevice (.is("revoked_at", null))
Verification INTEGRATION-GAP — no pgTAP/DB test exercises claim_device; the advisory-lock
             race and the revoke branch are unproven by automated test.
Acceptance   (a) N+1th distinct device_id for one user → 'denied';
             (b) two concurrent claims for the last slot → exactly one 'bound';
             (c) a binding with revoked_at set → 'denied' on re-claim AND DEVICE_MISMATCH on every data op;
             (d) with base-table grants revoked, no device_bindings row reachable via direct PostgREST.
Status       PARTIAL — logic present; (b) and (d) unverified, (d) blocked on the deferred
             grant-revoke (supabase/sql/revoke_table_grants.sql). This is R8's real fix,
             not a footnote. See appsec-review.md P0-A.
```

## Testability matrix

| Req | Automated anchor | Verified by |
|---|---|---|
| SR-AUTHN-01 | none | `getUserId` is I/O — **manual-review** |
| SR-AUTHZ-02 | `authz.test.js` (6) | **automated** |
| SR-AUTHZ-03 | `adminLogic.test.js::canActOnAccount` | **automated** |
| SR-AUTHZ-04 | `adminLogic.test.js::canInvoke` | **automated** |
| SR-STATUS-05 | `accountStatus.test.js` (8) | **automated** |
| SR-LOGIN-06 | `loginLogic.test.js` | **automated** |
| SR-AUDIT-07 | none | server-set `actor_id` — **manual-review** |
| SR-DEVLIM-08 | none | `claim_device` untested SQL — **integration-gap** |
| SR-INPUT-09 | `entryLimits.test.js` (7) | **automated** (new 2026-07-17) |

So SR-AUTHZ-02..06 and SR-INPUT-09 are unit-tested; **SR-AUTHN-01 and SR-AUDIT-07 rest on review, SR-DEVLIM-08 on nothing.**

## Threat-to-requirement traceability

| Goal | Coverage |
|---|---|
| **G1 — bypass time-limited demo** | **GAP.** Only client-side policy exists (`src/config/demoExpiry.js`, `src/security/trustedTimePolicy.js`). No server requirement → SR-ENTITLE-14 (P0) is unbuilt. |
| **G2 — defeat one-device license** | SR-DEVLIM-08 only, and **Partial** (untested race + deferred grant-revoke). |
| **G3 — extract secrets/creds** | SR-AUTHZ-02, SR-LOGIN-06, RLS-close migration, Android NSC. IPTV creds owner-scoped. Client token-at-rest uncovered → SR-SECRET-10. |
| **G4 — repackage & redistribute** | **GAP.** No requirement addressed binary integrity until SR-INTEGRITY-15 below. |

## New / expanded requirements

| ID | SHALL | Type | Threat | Pri | Risk | Enforced-by / target | Status |
|---|---|---|---|---|---|---|---|
| **SR-INPUT-09** | Reject any `entry` payload that is not an object with a string/number `id`, or exceeds 64 KiB serialized, with `INVALID_INPUT` 400 | Constraint | G3 (DoS) | P1 | Med | `_shared/entryLimits.js::validateEntry`, wired into `data/index.ts` history/favorites `.upsert` | **Holds** (impl. 2026-07-17; `entryLimits.test.js`) |
| SR-SECRET-10 | Auth session tokens (and IPTV creds) SHALL be stored in an OS keystore on native, not plaintext AsyncStorage | Non-func | G3 | P1 | High | target: `expo-secure-store` (`src/services/supabase.js:15`) | Gap |
| SR-TRANSPORT-11 | Control-plane (Supabase/auth) traffic SHALL use TLS with system-only trust anchors; cleartext limited to media origins; iOS ATS posture defined | Constraint | G3 | P1 | Med | `android/.../network_security_config.xml` (present, system-only anchor); iOS ATS scope undefined | Partial |
| SR-SESSION-12 | Refresh tokens SHALL rotate on use and be revocable; access-token TTL bounded; revocation effective within one TTL | Non-func | G2/G3 | P1 | High | GoTrue config (confirm rotation) + P0-A grant-revoke | Gap |
| SR-AUDIT-13 | Every super-admin/provider mutation SHALL write an `admin_audit` row; logs SHALL NOT contain passwords, tokens, or IPTV creds | Func | G3 | P2 | Med | `admin/index.ts::audit` → `_shared/auditMeta.js::scrubAuditMeta` (recursive secret-key strip) | `auditMeta.test.js` (6) for the no-creds half; mutation-coverage is **manual-review** | Partial → no-creds half **Holds** (impl. 2026-07-17); coverage manual-review |
| **SR-ENTITLE-14** | Trial/entitlement expiry SHALL be enforced server-side (entitlements table + `assertEntitled()` in claim-device/data); the client clock SHALL NOT be authoritative | Func | G1 | **P0** | Critical | target: new `entitlements` table + gate | **Gap** (root cause behind demo bypass) |
| SR-INTEGRITY-15 | Release artifacts SHALL enable available integrity checks with a verification step | Non-func | G4 | P2 | Low | Electron: `electron/afterPack.js` sets `OnlyLoadAppFromAsar:true` but **not** `EnableEmbeddedAsarIntegrityValidation` (tamper-detection gap); Android: Hermes/minify | Gap |

## Next actions (highest leverage)

1. **SR-DEVLIM-08 + P0-A:** add `pgTAP` for `claim_device` (race + revoke), then apply `revoke_table_grants.sql` once the functions-only client is live everywhere. Moves G2 from Partial → Holds.
2. **SR-ENTITLE-14:** design the server-side `entitlements` table — the only durable fix for G1.
3. **SR-SECRET-10:** migrate native session/creds to `expo-secure-store` (mind the ~2 KB key limit and session migration).
