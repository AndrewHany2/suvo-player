# Per-account library isolation (favorites & watch history)

**Date:** 2026-07-14
**Status:** Approved — ready for implementation plan

## Problem

Favorites (My-List) and watch history are persisted keyed by `userKey`
(the app **profile**, falling back to the Supabase auth user id) — never the
IPTV account. Two consequences the user wants changed:

1. **Not gated on an account.** You can sit in the app (MainTabs) with no active
   IPTV account (`activeUserId == null`) and still accumulate/see a library.
   Favorites and history should only be **available when an IPTV account is
   connected/active**.
2. **Shared across a profile's accounts.** All IPTV accounts in a profile share
   one library. Because a raw provider `streamId` only resolves on the account
   that issued it, an entry saved on account A can't play on account B. The user
   wants each account to have its **own isolated** favorites & history.

The uncommitted work in the tree took a *different* approach — "shared
per-profile, tag each entry with its origin `accountId`, show foreign entries
greyed with a *switch & play* action" (`src/context/accountScope.js`,
`useHistory` gating, detail-screen guards). The user has now chosen **true
isolation** instead, which supersedes that gating UX.

## Chosen approach

**Server-side per-account isolation.** Keep `user_key` = profile/auth id (so the
Supabase authorization layer is untouched) and add a **second partition column
`account_key`** to `watch_history` and `favorites`. Every read/write is scoped to
`(user_key, account_key)`, where `account_key = accountKeyOf(activeAccount)`.

- **No active IPTV account ⇒ no `account_key` ⇒ nothing loads or saves.** This is
  the "require a connected account" gate.
- The server returns only the active account's rows, so the client no longer
  needs any "foreign entry" detection or the greyed/switch UX — **that gating is
  removed.**
- **Legacy rows** (written before this feature) carry `account_key = ''` and
  therefore never match a real account ⇒ **hidden until re-saved** (the user's
  explicit choice). History ages out; favorites simply won't reappear until the
  user re-adds them.

### Why not a composite `user_key`
Folding the account into `user_key` (e.g. `profileId::accountId`) breaks
`assertOwnsUserKey` / `userKeyIsAuthorized`
(`supabase/functions/_shared/`), which authorize `user_key` only when it equals
the caller's auth id or an `app_profile` they own. A separate `account_key`
partition column keeps that authorization check exactly as-is — `account_key` is
just a sub-partition *within* the caller's own already-authorized data, so it
needs no extra ownership check (worst case a user partitions their own data).

## Components & changes

### Server — `supabase/`

1. **New migration** `supabase/migrations/<ts>_library_account_scope.sql`
   (additive & idempotent, following the `device_bindings` style):
   - `alter table public.watch_history add column if not exists account_key text not null default '';`
   - `alter table public.favorites     add column if not exists account_key text not null default '';`
   - Drop the existing `(user_key, entry_id)` unique constraint/index — its name
     is unknown (dashboard-managed), so use a `DO` block that finds and drops any
     UNIQUE constraint or index defined on exactly `(user_key, entry_id)` for
     each table. This is required: the old constraint would forbid two accounts
     under the same profile from holding the same `entry_id`.
   - Add unique index `(user_key, account_key, entry_id)` on each table
     (`create unique index if not exists`).
   - Legacy rows are backfilled to `account_key = ''` by the column default.

2. **`supabase/functions/data/index.ts`** — the six library actions
   (`history.fetch/upsert/delete`, `favorites.fetch/upsert/delete`) read
   `payload.accountKey` and:
   - `.eq("account_key", payload.accountKey)` on fetch/delete,
   - include `account_key: payload.accountKey` in upsert rows,
   - use `onConflict: "user_key,account_key,entry_id"`.
   `assertOwnsUserKey` and `authz.js` are unchanged.

### Client — `src/`

3. **`src/services/supabase.js`** — `fetchRemoteHistory`, `upsertHistoryEntry`,
   `deleteHistoryEntry`, `fetchFavorites`, `upsertFavorite`, `deleteFavorite`
   each gain an `accountKey` argument, passed through in the payload.

4. **`src/context/AppContext.jsx`**
   - Pass `activeAccountId` (via `accountKeyOf(activeAccount)`) as `accountKey` to
     every library call.
   - `loadLibrary` re-keys on `(userKey, accountKey)`; the load effect depends on
     both and **reloads when the active account switches**.
   - When `activeAccountId == null`: clear `watchHistory` + `myList`, do **not**
     fetch, and make `addToWatchHistory` / `updateWatchProgress` / `addToMyList`
     **no-ops** (require a connected account).
   - Local (offline / Supabase-off) favorites storage key becomes
     account-scoped: `iptv_mylist_${userKey}_${accountId}`.
   - Simplify the My-List entry id back to `mylist_${type}_${streamId}`
     (uniqueness across accounts is now provided by `account_key`), and revert
     the `removeFromMyList` legacy-key reconstruction added by the uncommitted
     work.

5. **`src/context/accountScope.js`** — shrink to `accountKeyOf` and
   `accountLabelOf` (the latter used for empty-state copy). **Remove**
   `isForeign`, `matchesAccount`, `stampAccount`; update
   `src/context/accountScope.test.js` accordingly.

6. **`src/domain/hooks/useHistory.js`** — remove `isForeignEntry`, `originLabel`,
   `runGuarded`, `confirmSwitch`, and the switch-account plumbing. `playLive`
   plays directly.

7. **Screens & detail views** — `MovieDetail(.web)`, `SeriesDetail(.web)`,
   `HistoryScreen.{web,native,tv}`, `MoviesScreen.{web,native,tv}`,
   `SeriesScreen.{web,native,tv}`, `LiveTVScreen.{web,native,tv}`:
   - Remove foreign-greyed visuals, "switch & play" dialogs, and `matchesAccount`
     lookups (the fetched lists are already single-account).
   - Add a **"Connect an IPTV account to save favorites & history"** empty state
     (with an action that opens the Accounts modal) wherever a library view —
     History tab, My-List shelf — would render with no active account, and
     hide/disable add-to-list controls in that state.

## Data flow

```
active IPTV account selected
   └─ accountKey = accountKeyOf(activeAccount)
        ├─ AppContext.loadLibrary(userKey, accountKey)
        │     └─ data fn: select … where user_key=? and account_key=?
        ├─ add/remove favorite  → favorites.upsert/delete {userKey, accountKey, entry}
        └─ watch/progress write → history.upsert         {userKey, accountKey, entry}

no active account (activeAccountId == null)
   └─ lists cleared, no fetch, writes no-op, empty-state shown
```

## Error handling

- Remote sync stays best-effort (existing `try/catch` + `console.warn`); a failed
  upsert doesn't surface the red overlay. Unchanged.
- Switching accounts mid-write: writes are stamped/scoped with the account that
  was active when scheduled (progress flush reads `activeAccountRef`), so a
  deferred flush lands in the correct account partition.
- Missing/empty `accountKey` on the server is treated as the legacy `''`
  partition; the client never sends library writes without an active account, so
  real writes always carry a non-empty key.

## Testing

- Rewrite `src/context/accountScope.test.js` for the trimmed API
  (`accountKeyOf`, `accountLabelOf`).
- Keep `supabase/functions/_shared/authz.test.js` (authz unchanged).
- `historyProgress.test.js` — unaffected; adjust only if the entry shape changes.
- Manual two-account verification on **web, native, and TV**:
  save on account A → switch to B (A's items absent, empty controls behave) →
  back to A (items present); confirm legacy items stay hidden; confirm the
  no-account empty state and disabled saving.
- `npm test` and `npm run lint` green before commit.

## Rollout / risk

- **Deploy ordering is critical:** apply the migration **and** redeploy the
  `data` edge function together. The constraint swap without the new function
  (or vice-versa) breaks library writes.
- **Existing users lose their visible library** on upgrade: all current rows are
  `account_key = ''` and become hidden until re-saved — this is the accepted
  "hide until re-saved" behavior.
- The change reshapes uncommitted files rather than layering on top; the
  cross-account "switch & play" convenience is intentionally dropped.

## Out of scope (YAGNI)

- Migrating/attributing existing legacy rows to a specific account (no reliable
  mapping exists; they age out / get re-saved).
- A TV disabled-visual badge for foreign entries (no foreign entries exist under
  isolation).
- Any UI to view another account's library while a different account is active.
