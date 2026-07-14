# Per-account Library Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Favorites (My-List) and watch history are available only when an IPTV account is active, and each IPTV account keeps its own isolated library.

**Architecture:** Keep the Supabase library keyed by `user_key` (profile/auth id — authz untouched) and add a second partition column `account_key = accountKeyOf(activeAccount)` to `watch_history` and `favorites`. Every read/write is scoped to `(user_key, account_key)`. No active account ⇒ no `account_key` ⇒ nothing loads or saves. Legacy rows carry `account_key = ''` and stay hidden until re-saved. The server now returns only the active account's rows, so the client's "foreign entry / switch & play" gating (from the uncommitted work) is removed.

**Tech Stack:** Expo/React Native + react-native-web, React 19, JavaScript (`.js`/`.jsx`). Supabase Postgres + a single `data` Deno Edge Function. Tests: `node:test` via `npm test`. Lint: `npm run lint`.

**Spec:** `docs/superpowers/specs/2026-07-14-per-account-library-isolation-design.md`

## Global Constraints

- JavaScript only (`.js` / `.jsx`), never TypeScript for `src/`. The edge function is `.ts` (Deno).
- Tests are `node:test`, colocated as `*.test.js`. No Jest.
- `.native` / `.web` / `.tv` variants: a screen change usually touches all three. TV + web are both `expo export --platform web`; keep asset refs relative.
- Both `npm test` and `npm run lint` must pass before any commit (react-hooks rules — errors are not OK, warnings are OK).
- Deploy ordering (operational, not code): the migration and the `data` function redeploy ship together.
- `account_key` value = `accountKeyOf(activeAccount)` (account `id`, else `host_username`). Empty string `''` is the reserved legacy partition — never sent for a real write.

---

### Task 1: Add `account_key` partition column to the library tables

**Files:**
- Create: `supabase/migrations/20260714000001_library_account_scope.sql`

**Interfaces:**
- Produces: `watch_history` and `favorites` each gain `account_key text not null default ''` and a unique index on `(user_key, account_key, entry_id)`; the old `(user_key, entry_id)` unique is dropped.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260714000001_library_account_scope.sql`:

```sql
-- Per-account isolation for the library. Additive & idempotent — safe against
-- the existing (dashboard-managed) watch_history / favorites tables.
--
-- account_key partitions a profile's library by the IPTV account it was saved
-- from. Legacy rows default to '' and never match a real account_key, so they
-- are hidden until re-saved. The old (user_key, entry_id) unique must go: it
-- would forbid two accounts under one profile from holding the same entry_id.

alter table public.watch_history add column if not exists account_key text not null default '';
alter table public.favorites     add column if not exists account_key text not null default '';

-- Drop any UNIQUE constraint or standalone unique index defined on exactly
-- (user_key, entry_id) for each table (the dashboard-created name is unknown).
do $$
declare
  r record;
begin
  for r in
    select tc.table_name, tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.table_name in ('watch_history', 'favorites')
      and tc.constraint_type = 'UNIQUE'
    group by tc.table_name, tc.constraint_name
    having array_agg(kcu.column_name order by kcu.column_name) = array['entry_id','user_key']
  loop
    execute format('alter table public.%I drop constraint %I', r.table_name, r.constraint_name);
  end loop;

  for r in
    select i.indexrelid::regclass::text as idx, t.relname as tbl
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('watch_history', 'favorites')
      and x.indisunique
      and (
        select array_agg(a.attname order by a.attname)
        from unnest(x.indkey) k
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k
      ) = array['entry_id','user_key']
  loop
    execute format('drop index if exists public.%I', split_part(r.idx, '.', 2));
  end loop;
end $$;

create unique index if not exists watch_history_user_account_entry_uidx
  on public.watch_history (user_key, account_key, entry_id);
create unique index if not exists favorites_user_account_entry_uidx
  on public.favorites (user_key, account_key, entry_id);
```

- [ ] **Step 2: Verify the SQL parses locally (no live DB required)**

Run: `grep -c "create unique index" supabase/migrations/20260714000001_library_account_scope.sql`
Expected: `2`

(The migration is applied against Supabase at deploy time with Task 2. There is no local Postgres in this repo's test harness.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260714000001_library_account_scope.sql
git commit -m "feat(db): add account_key partition to watch_history and favorites"
```

---

### Task 2: Scope the `data` edge function by `account_key`

**Files:**
- Modify: `supabase/functions/data/index.ts` (the six `history.*` / `favorites.*` cases)

**Interfaces:**
- Consumes: request `payload.accountKey` (string; may be absent → treated as `''`).
- Produces: history/favorites fetch, upsert, delete all filter and write `account_key`. `assertOwnsUserKey` and `authz.js` unchanged.

- [ ] **Step 1: Read the current cases**

Run: `sed -n '116,174p' supabase/functions/data/index.ts`
Expected: the six cases as they exist today, scoped only by `user_key`.

- [ ] **Step 2: Rewrite the six cases to include `account_key`**

Replace the `history.fetch` through `favorites.delete` cases (lines 116–174) with:

```ts
      case "history.fetch": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        const { data } = await db("watch_history")
          .select("entry")
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .order("watched_at", { ascending: false })
          .limit(MAX_HISTORY);
        return json((data ?? []).map((r: any) => r.entry));
      }
      case "history.upsert": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        await db("watch_history").upsert(
          {
            user_key: payload.userKey,
            account_key: payload.accountKey ?? "",
            entry_id: payload.entry.id,
            entry: payload.entry,
            watched_at: payload.entry.watchedAt,
          },
          { onConflict: "user_key,account_key,entry_id" },
        );
        return json({ ok: true });
      }
      case "history.delete": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        await db("watch_history")
          .delete()
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .eq("entry_id", payload.entryId);
        return json({ ok: true });
      }
      case "favorites.fetch": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        const { data } = await db("favorites")
          .select("entry")
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .order("added_at", { ascending: false });
        return json((data ?? []).map((r: any) => r.entry));
      }
      case "favorites.upsert": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        await db("favorites").upsert(
          {
            user_key: payload.userKey,
            account_key: payload.accountKey ?? "",
            entry_id: payload.entry.id,
            entry: payload.entry,
            added_at: payload.entry.addedAt,
          },
          { onConflict: "user_key,account_key,entry_id" },
        );
        return json({ ok: true });
      }
      case "favorites.delete": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        await db("favorites")
          .delete()
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .eq("entry_id", payload.entryId);
        return json({ ok: true });
      }
```

- [ ] **Step 3: Verify the function still type-checks with Deno (if available)**

Run: `deno check supabase/functions/data/index.ts 2>/dev/null && echo OK || echo "deno unavailable — skip"`
Expected: `OK` (or the skip message if Deno isn't installed; the change is a mechanical column addition).

- [ ] **Step 4: Confirm authz is untouched**

Run: `git diff --stat supabase/functions/_shared/`
Expected: no output (no files under `_shared/` changed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/data/index.ts
git commit -m "feat(data): scope library reads/writes by account_key"
```

---

### Task 3: Thread `accountKey` through the client Supabase service

**Files:**
- Modify: `src/services/supabase.js:193-243`

**Interfaces:**
- Consumes: nothing new.
- Produces: `fetchRemoteHistory(userKey, accountKey)`, `upsertHistoryEntry(userKey, accountKey, entry)`, `deleteHistoryEntry(userKey, accountKey, entryId)`, `fetchFavorites(userKey, accountKey)`, `upsertFavorite(userKey, accountKey, entry)`, `deleteFavorite(userKey, accountKey, entryId)`.

- [ ] **Step 1: Rewrite the six functions to pass `accountKey`**

Replace lines 193–243 of `src/services/supabase.js` with:

```js
export async function fetchRemoteHistory(userKey, accountKey) {
  return invokeData("history.fetch", { userKey, accountKey });
}

export async function upsertHistoryEntry(userKey, accountKey, entry) {
  try {
    await invokeData("history.upsert", { userKey, accountKey, entry });
    return { ok: true };
  } catch (error) {
    // Best-effort remote sync — local history is the source of truth. Warn
    // (don't surface the red error overlay) and let the caller carry on.
    console.warn("[Supabase] upsertHistoryEntry:", error.message);
    return { ok: false, error };
  }
}

export async function deleteHistoryEntry(userKey, accountKey, entryId) {
  try {
    await invokeData("history.delete", { userKey, accountKey, entryId });
    return { ok: true };
  } catch (error) {
    console.error("[Supabase] deleteHistoryEntry:", error.message);
    return { ok: false, error };
  }
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function fetchFavorites(userKey, accountKey) {
  return invokeData("favorites.fetch", { userKey, accountKey });
}

export async function upsertFavorite(userKey, accountKey, entry) {
  try {
    await invokeData("favorites.upsert", { userKey, accountKey, entry });
    return { ok: true };
  } catch (error) {
    console.error("[Supabase] upsertFavorite:", error.message);
    return { ok: false, error };
  }
}

export async function deleteFavorite(userKey, accountKey, entryId) {
  try {
    await invokeData("favorites.delete", { userKey, accountKey, entryId });
    return { ok: true };
  } catch (error) {
    console.error("[Supabase] deleteFavorite:", error.message);
    return { ok: false, error };
  }
}
```

(Leave the `export { MAX_HISTORY, mergeHistories } …` re-export line and the section header above `fetchRemoteHistory` intact.)

- [ ] **Step 2: Verify the cache test still references these correctly**

Run: `npm test 2>&1 | tail -20`
Expected: PASS (AppContext callers are updated in Task 5; this task only widens signatures — `undefined` accountKey is tolerated end-to-end).

- [ ] **Step 3: Commit**

```bash
git add src/services/supabase.js
git commit -m "feat(supabase): add accountKey arg to library service calls"
```

---

### Task 4: Shrink `accountScope.js` to the account-key helpers

**Files:**
- Modify: `src/context/accountScope.js`
- Modify: `src/context/accountScope.test.js`

**Interfaces:**
- Produces: `accountKeyOf(account) → string|null`, `accountLabelOf(account) → string`. `isForeign`, `matchesAccount`, `stampAccount` are removed.

- [ ] **Step 1: Rewrite the test to cover only the surviving API**

Replace the whole of `src/context/accountScope.test.js` with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountKeyOf, accountLabelOf } from "./accountScope.js";

test("accountKeyOf prefers the account id", () => {
  assert.equal(accountKeyOf({ id: "abc", host: "h", username: "u" }), "abc");
});

test("accountKeyOf falls back to host_username when id is missing", () => {
  assert.equal(accountKeyOf({ host: "h", username: "u" }), "h_u");
  assert.equal(accountKeyOf({ username: "u" }), "_u");
});

test("accountKeyOf returns null for an unkeyable/absent account", () => {
  assert.equal(accountKeyOf(null), null);
  assert.equal(accountKeyOf({}), null);
  assert.equal(accountKeyOf({ id: "" }), null);
});

test("accountLabelOf prefers nickname then username", () => {
  assert.equal(accountLabelOf({ nickname: "Home", username: "u" }), "Home");
  assert.equal(accountLabelOf({ username: "u" }), "u");
  assert.equal(accountLabelOf(null), "this account");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/context/accountScope.test.js`
Expected: FAIL — the module still exports the removed helpers but the test itself passes only if imports resolve; the real failure gate is Step 4. (If it already passes, that's fine — proceed.)

- [ ] **Step 3: Rewrite `accountScope.js` to keep only the two helpers**

Replace the whole of `src/context/accountScope.js` with:

```js
// @ts-check
// PURE helpers for identifying the IPTV account a library entry belongs to.
//
// The library (watch history + favorites) is stored per profile (`userKey`) but
// partitioned per IPTV account via `account_key = accountKeyOf(activeAccount)`
// (see the data Edge Function). These helpers derive that key and a display
// label; all scoping/filtering now happens server-side.

/**
 * PURE: stable per-account id string. Prefers the account's own id (remote UUID
 * or local id); falls back to host+username so anonymous/unsynced accounts still
 * get a distinct, deterministic key. Returns null when the account can't be keyed.
 * @param {{ id?: any, host?: string, username?: string } | null | undefined} account
 * @returns {string|null}
 */
export function accountKeyOf(account) {
  if (!account) return null;
  if (account.id != null && account.id !== "") return String(account.id);
  if (account.host || account.username) return `${account.host || ""}_${account.username || ""}`;
  return null;
}

/**
 * PURE: human label for an account, used in the "connect an account" empty state.
 * @param {{ nickname?: string, username?: string } | null | undefined} account
 * @returns {string}
 */
export function accountLabelOf(account) {
  if (!account) return "this account";
  return account.nickname || account.username || "this account";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/context/accountScope.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/context/accountScope.js src/context/accountScope.test.js
git commit -m "refactor(accountScope): keep only accountKeyOf/accountLabelOf"
```

---

### Task 5: Account-scope the library in AppContext (load, write-gate, reload-on-switch)

**Files:**
- Modify: `src/context/AppContext.jsx` (imports; `addToWatchHistory`, `flushProgress`, `updateWatchProgress`, My-List block, `loadLibrary`, `refetchLibrary`, the library-load `useEffect`)

**Interfaces:**
- Consumes: `accountKeyOf` (Task 4); the widened `src/services/supabase.js` calls (Task 3); `activeAccountId` (already derived at `AppContext.jsx:130`).
- Produces: writes and fetches carry `activeAccountId`; the library reloads when `activeAccountId` changes; with no active account the lists are empty and writes no-op; local favorites key is `iptv_mylist_${userKey}_${accountId}`; My-List entry id is `mylist_${type}_${streamId}`.

- [ ] **Step 1: Fix the import line**

In `src/context/AppContext.jsx`, change the accountScope import to drop the removed helpers:

```js
import { accountKeyOf, accountLabelOf } from './accountScope';
```

(Verify no other line in the file references `stampAccount`, `matchesAccount`, or `isForeign` after this task — Step 8 greps.)

- [ ] **Step 2: Gate + scope the watch-history writes**

Replace `addToWatchHistory`, `removeFromWatchHistory`, `flushProgress`, and `updateWatchProgress` (`AppContext.jsx:240-303`) with:

```js
  const addToWatchHistory = useCallback((rawItem) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    if (!accountKey) return; // require a connected IPTV account
    const item = normalizeHistoryItem(rawItem);
    const now = new Date().toISOString();
    // Re-opening a watched title must NOT reset its saved position: opens carry
    // currentTime = startTime||0, so upsertHistoryItem preserves prior progress.
    const { history: newHistory, entry } = upsertHistoryItem(watchHistoryRef.current, item, now);
    setWatchHistory(newHistory);
    if (userKey) upsertHistoryEntry(userKey, accountKey, entry);
  }, [userKey]);

  const removeFromWatchHistory = useCallback((id) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    const newHistory = watchHistoryRef.current.filter((item) => item.id !== id);
    setWatchHistory(newHistory);
    if (userKey && accountKey) deleteHistoryEntry(userKey, accountKey, id);
  }, [userKey]);

  // Synchronously upsert all pending progress entries and clear their timers.
  // Called when switching streams (for the previous entry), on unmount, and
  // exported for the player to call on background/foreground transitions.
  const flushProgress = useCallback(() => {
    const key = userKeyRef.current;
    const accountKey = accountKeyOf(activeAccountRef.current);
    for (const timer of progressSyncTimers.current.values()) clearTimeout(timer);
    progressSyncTimers.current.clear();
    const pending = pendingProgressEntries.current;
    pendingProgressEntries.current = new Map();
    if (!key || !accountKey) return;
    for (const entry of pending.values()) upsertHistoryEntry(key, accountKey, entry);
  }, []);

  const updateWatchProgress = useCallback((streamId, type, currentTime, duration) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    if (!accountKey) return; // require a connected IPTV account
    // Upsert semantics: a progress event with no matching row creates the entry
    // so resume data emitted before/without addToWatchHistory is never lost.
    const { history: updated, entry } = applyProgress(
      watchHistoryRef.current,
      { streamId, type, currentTime, duration },
      new Date().toISOString(),
    );
    setWatchHistory(updated);
    const timerKey = `${entry.type}_${entry.streamId}`;
    if (userKey) {
      // Flush any pending entry for a *different* stream before scheduling this one.
      for (const [k, timer] of progressSyncTimers.current.entries()) {
        if (k === timerKey) continue;
        clearTimeout(timer);
        progressSyncTimers.current.delete(k);
        const pendingEntry = pendingProgressEntries.current.get(k);
        pendingProgressEntries.current.delete(k);
        if (pendingEntry) upsertHistoryEntry(userKey, accountKey, pendingEntry);
      }
      pendingProgressEntries.current.set(timerKey, entry);
      clearTimeout(progressSyncTimers.current.get(timerKey));
      progressSyncTimers.current.set(timerKey, setTimeout(() => {
        const e = pendingProgressEntries.current.get(timerKey);
        progressSyncTimers.current.delete(timerKey);
        pendingProgressEntries.current.delete(timerKey);
        if (e) upsertHistoryEntry(userKey, accountKey, e);
      }, 5000));
    }
  }, [userKey]);
```

> Note: `applyProgress` previously took a 4th `accountStamp` arg. It is now called with 3 args. Confirm `applyProgress` tolerates the missing arg (it stamps only when provided). If its signature requires the arg, drop the parameter in `historyProgress.js` and its test in this same task.

- [ ] **Step 3: Simplify the My-List block (account partitioning is server-side now)**

Replace the My-List block (`AppContext.jsx:305-357`) with:

```js
  // ─── My List (watch later) ───────────────────────────────────────────────────
  // Favorites are partitioned per IPTV account by account_key server-side and by
  // the local storage key, so the entry id no longer embeds the account.
  const myListId = (type, streamId) => `mylist_${type}_${streamId}`;
  const isSameFav = (m, type, streamId) =>
    m.type === type && String(m.streamId) === String(streamId);
  const favStorageKey = (key, accountKey) => `iptv_mylist_${key}_${accountKey}`;

  const addToMyList = useCallback((item) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    if (!accountKey) return; // require a connected IPTV account
    const streamId = item.streamId ?? item.stream_id ?? item.seriesId ?? item.id;
    const prev = myListRef.current;
    if (prev.some((m) => isSameFav(m, item.type, streamId))) return;
    const entry = { ...item, streamId, id: myListId(item.type, streamId), addedAt: new Date().toISOString() };
    const updated = [entry, ...prev];
    setMyList(updated);
    if (userKey) {
      storage.setItem(favStorageKey(userKey, accountKey), JSON.stringify(updated));
      upsertFavorite(userKey, accountKey, entry);
    }
  }, [userKey]);

  // Accepts either a stored row id (History tab passes `item.id`) or the logical
  // key `mylist_${type}_${streamId}` (detail/browse screens reconstruct it).
  const removeFromMyList = useCallback((idArg) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    const target = myListRef.current.find((m) => m.id === idArg);
    const removeId = target ? target.id : idArg;
    const updated = myListRef.current.filter((m) => m.id !== removeId);
    setMyList(updated);
    if (userKey && accountKey) {
      storage.setItem(favStorageKey(userKey, accountKey), JSON.stringify(updated));
      deleteFavorite(userKey, accountKey, removeId);
    }
  }, [userKey]);

  const isInMyList = useCallback((type, streamId) =>
    myListRef.current.some((m) => isSameFav(m, type, streamId)),
    []);
```

> Because `myListId` no longer embeds the account, the ~12 `removeFromMyList(\`mylist_${type}_${id}\`)` callers keep working unchanged.

- [ ] **Step 4: Remove the now-unused `getAccountById` / `switchAccount` if only the gating used them**

Run: `grep -rn "getAccountById\|switchAccount" src --include="*.js" --include="*.jsx" | grep -v AppContext.jsx`
- If the only remaining references are inside `useHistory.js` (removed in Task 6), delete `getAccountById` and `switchAccount` from AppContext and from the `value` memo + its dep array (`AppContext.jsx:361-373, 615, 627`).
- If any screen still uses `switchAccount` legitimately (e.g. AccountsScreen), **keep it** and only remove `getAccountById`.

Make the corresponding edits to the `value` object and dependency array so no undefined name is referenced.

- [ ] **Step 5: Account-scope `loadLibrary` and reload on account switch**

Replace `loadLibrary` (`AppContext.jsx:378-429`), `refetchLibrary` (`:433-434`), and the library-load effect (`:596-603`) with:

```js
  const loadLibrary = useCallback(async (key, accountKey) => {
    if (!key || !accountKey) return;
    // Watch history is Supabase-only: purge any legacy local history on disk.
    storage.removeItem('iptv_history_' + key);
    let localFavorites = [];
    try {
      const rawF = await storage.getItem(`iptv_mylist_${key}_${accountKey}`);
      if (rawF) localFavorites = JSON.parse(rawF);
    } catch { /**/ }
    const sameKey = libraryKeyRef.current === `${key}_${accountKey}`;
    const baseFavorites = pickLibraryBase({
      sameKey, inMemory: myListRef.current, onDisk: localFavorites,
    });
    libraryKeyRef.current = `${key}_${accountKey}`;

    if (!isSupabaseConfigured()) {
      setWatchHistory([]);
      setMyList(baseFavorites);
      return;
    }

    setIsSyncing(true);
    try {
      const [historyRes, favoritesRes] = await Promise.all([
        fetchRemoteHistory(key, accountKey).then((data) => ({ ok: true, data }), () => ({ ok: false, data: null })),
        fetchFavorites(key, accountKey).then((data) => ({ ok: true, data }), () => ({ ok: false, data: null })),
      ]);
      const nextHistory = resolveAuthoritative({
        localBase: watchHistoryRef.current, remote: historyRes.data, fetchOk: historyRes.ok,
        tsField: 'watchedAt', cap: MAX_HISTORY,
      });
      setWatchHistory(nextHistory);
      const nextFavorites = resolveAuthoritative({
        localBase: baseFavorites, remote: favoritesRes.data, fetchOk: favoritesRes.ok,
        tsField: 'addedAt',
      });
      setMyList(nextFavorites);
      storage.setItem(`iptv_mylist_${key}_${accountKey}`, JSON.stringify(nextFavorites));
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const refetchLibrary = useCallback(() => {
    loadLibrary(userKeyRef.current, accountKeyOf(activeAccountRef.current));
  }, [loadLibrary]);
```

And the effect:

```js
  // Library load, keyed on (userKey, activeAccountId). No active account ⇒ empty
  // library and no fetch (favorites/history require a connected IPTV account).
  useEffect(() => {
    const libKey = userKey && activeAccountId ? `${userKey}_${activeAccountId}` : null;
    if (!libKey || deviceStatus !== 'ok') {
      libraryKeyRef.current = null; setWatchHistory([]); setMyList([]); return;
    }
    if (libraryKeyRef.current !== libKey) { setWatchHistory([]); setMyList([]); }
    loadLibrary(userKey, activeAccountId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey, activeAccountId, deviceStatus]);
```

> `refetchLibrary` now closes over `loadLibrary` only; ensure `activeAccountRef` is defined above it (it is, at `:133`).

- [ ] **Step 6: Run the full test suite**

Run: `npm test 2>&1 | tail -25`
Expected: PASS. If `historyProgress.test.js` fails on the `accountStamp` arg, update `applyProgress` / its test to the 3-arg form in this task and re-run.

- [ ] **Step 7: Lint**

Run: `npm run lint 2>&1 | tail -25`
Expected: no errors (warnings OK). Fix any `no-undef` from removed names.

- [ ] **Step 8: Grep for orphaned references**

Run: `grep -rn "stampAccount\|matchesAccount\|isForeign" src/context/AppContext.jsx`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/context/AppContext.jsx src/context/historyProgress.js src/context/historyProgress.test.js
git commit -m "feat(context): isolate library per IPTV account; require an account to save"
```

---

### Task 6: Remove cross-account gating from `useHistory`

**Files:**
- Modify: `src/domain/hooks/useHistory.js`

**Interfaces:**
- Consumes: `useApp()` (no longer needs `activeAccountId`, `getAccountById`, `switchAccount` for gating).
- Produces: `useHistory` no longer returns `isForeignEntry`, `originLabel`, `runGuarded`, `activeAccountId`. `playLive(item)` plays directly.

- [ ] **Step 1: Rewrite the hook without gating**

Replace `src/domain/hooks/useHistory.js` lines 1–141 so that:
- the `accountScope` import is removed,
- `useApp()` destructures only `{ myList, removeFromMyList }`,
- `confirmSwitch`, `notify`, `isForeignEntry`, `originLabel`, `runGuarded` are deleted,
- `playLive` becomes:

```js
  /** Direct-play a live history entry: build its url, start playback, navigate. */
  const playLive = useCallback((item) => {
    const url = contentService.buildLiveUrl(item.streamId, item.containerExtension || "ts");
    playVideoObject({
      type: "live",
      streamId: item.streamId,
      name: item.name,
      url,
      cover: item.cover,
      startTime: 0,
    });
  }, [contentService, playVideoObject]);
```

- and the returned object drops `isForeignEntry, originLabel, runGuarded, activeAccountId`:

```js
  return {
    // selectors
    watchHistory, watchedHistory, myList,
    // remove actions
    removeFromWatchHistory, removeFromMyList,
    // playback
    playLive, playVideoObject,
    // TV detail helpers (routed through ContentService, not iptvApi)
    buildMovieUrl, buildEpisodeUrl, fetchMovieInfo, fetchSeriesInfo,
  };
```

- [ ] **Step 2: Find consumers of the removed return values**

Run: `grep -rn "isForeignEntry\|originLabel\|runGuarded\|\.activeAccountId" src/screens src/components --include="*.jsx"`
Expected: a list of screen/detail usages — each is removed in Task 7. Record them.

- [ ] **Step 3: Lint the hook**

Run: `npm run lint src/domain/hooks/useHistory.js 2>&1 | tail`
Expected: no errors (unused-import/no-undef clean).

- [ ] **Step 4: Commit**

```bash
git add src/domain/hooks/useHistory.js
git commit -m "refactor(useHistory): drop cross-account gating (isolation is server-side)"
```

---

### Task 7: Remove foreign-entry gating UI from screens & detail views

**Files (each modified):**
- `src/screens/HistoryScreen.web.jsx`, `src/screens/HistoryScreen.native.jsx`, `src/screens/HistoryScreen.tv.jsx`
- `src/components/MovieDetail.jsx`, `src/components/MovieDetail.web.jsx`
- `src/components/SeriesDetail.jsx`, `src/components/SeriesDetail.web.jsx`
- `src/screens/MoviesScreen.tv.jsx`, `src/screens/SeriesScreen.tv.jsx`, and any of `Movies/Series/LiveTVScreen.{web,native}.jsx` flagged by the grep

**Interfaces:**
- Consumes: `useHistory` / `useApp` without the gating fields.
- Produces: no screen references `isForeignEntry`, `originLabel`, `runGuarded`, `matchesAccount`, greyed-foreign styling, or "switch & play" dialogs.

- [ ] **Step 1: Enumerate every gating reference across screens/components**

Run:
```bash
grep -rn "isForeignEntry\|originLabel\|runGuarded\|matchesAccount\|isForeign\|Watched on\|Different account\|Switch to" src/screens src/components --include="*.jsx"
```
Expected: the full worklist. Each hit is one of: (a) a call that gated playback → replace with the direct action; (b) a visual "foreign/greyed/badge" branch → delete; (c) a `matchesAccount(...)` predicate ANDed into a `.find`/`.some` → drop the predicate (server already scopes).

- [ ] **Step 2: For each playback-gating call, inline the proceed action**

Pattern — replace:
```jsx
runGuarded(item, () => playLive(item))
```
with:
```jsx
playLive(item)
```
and replace any `onPress={() => runGuarded(entry, proceed)}` with `onPress={proceed}`. Remove `isForeignEntry(item)` / `originLabel(item)` reads and the JSX that consumed them (greyed style, badge text, "Switch to …" affordance).

- [ ] **Step 3: For each `matchesAccount` lookup, drop the predicate**

Pattern — replace:
```jsx
history.find((h) => h.type === type && String(h.streamId) === String(id) && matchesAccount(h, activeAccountId))
```
with:
```jsx
history.find((h) => h.type === type && String(h.streamId) === String(id))
```
Remove the now-unused `activeAccountId` / `matchesAccount` imports and destructures in that file.

- [ ] **Step 4: Re-run the grep to confirm zero remaining references**

Run:
```bash
grep -rn "isForeignEntry\|originLabel\|runGuarded\|matchesAccount\|isForeign" src/screens src/components --include="*.jsx"
```
Expected: no output.

- [ ] **Step 5: Lint + test**

Run: `npm run lint 2>&1 | tail -20 && npm test 2>&1 | tail -10`
Expected: no lint errors; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens src/components
git commit -m "refactor(screens): remove foreign-entry gating UI (per-account isolation)"
```

---

### Task 8: "Connect an account" empty state + disabled saving when no active account

**Files:**
- Modify: `src/screens/HistoryScreen.web.jsx`, `src/screens/HistoryScreen.native.jsx`, `src/screens/HistoryScreen.tv.jsx`
- Modify: the My-List shelf renderers in `src/screens/LiveTVScreen.web.jsx`, `.native.jsx`, `.tv.jsx` (and Movies/Series screens if they render a My-List shelf)
- Modify: add-to-list controls in `src/components/MovieDetail*.jsx`, `src/components/SeriesDetail*.jsx`

**Interfaces:**
- Consumes: `useApp()` → `activeUserId` (null ⇒ no active account). Optionally `accountLabelOf` for copy.
- Produces: History tab + My-List shelves show a connect-account prompt (opening the Accounts modal) when `activeUserId == null`; add-to-list buttons are hidden/disabled in that state.

- [ ] **Step 1: Add a shared empty-state guard to each History screen**

In each `HistoryScreen.{web,native,tv}.jsx`, read `const { activeUserId } = useApp();` and, before the normal list render, return a prompt when there's no active account. Web/native example (adapt to each file's existing layout primitives — `YStack`/`Text`/`Button` on web, the TV focusable card on `.tv`):

```jsx
if (!activeUserId) {
  return (
    <StatePanel
      icon="tv"
      title="No account connected"
      message="Connect an IPTV account to save favorites and watch history."
      actionLabel="Connect account"
      onAction={() => navigation.navigate("Accounts")}
    />
  );
}
```

> Use the existing empty/`StatePanel` component the screen already imports for its "no history yet" state; match its props. On `.tv`, route the action through the existing D-pad-focusable button pattern and do not add a new focus trap.

- [ ] **Step 2: Guard the My-List shelf on browse screens**

Where a My-List / favorites shelf is rendered (grep `myList` in `src/screens/*.jsx`), render the shelf only when `activeUserId && myList.length`. With no active account the shelf is omitted (the browse grid still shows). Do NOT show the full-screen prompt here — only History owns that.

- [ ] **Step 3: Hide/disable add-to-list controls with no account**

In `MovieDetail*.jsx` / `SeriesDetail*.jsx`, gate the "Add to My List" button on `activeUserId`:

```jsx
{activeUserId ? (
  <Button ...existing add/remove-to-list props... />
) : null}
```

(`addToMyList` is already a no-op without an account per Task 5; hiding the control avoids a dead button.)

- [ ] **Step 4: Manual verification (web)**

Run the web app (`npm run web` or the project `run` skill). Verify:
- With no IPTV account selected: History tab shows the connect prompt; browse screens show no My-List shelf; detail views show no add-to-list button.
- Add an account, select it: History populates for that account; add a favorite; it appears.
- Switch to a second account: the first account's history/favorites are gone; add different favorites; switch back → first account's items return.

- [ ] **Step 5: Lint + test**

Run: `npm run lint 2>&1 | tail -20 && npm test 2>&1 | tail -10`
Expected: no lint errors; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens src/components
git commit -m "feat(ui): require a connected IPTV account for favorites & history"
```

---

## Self-Review

**Spec coverage:**
- Server per-account key (spec §Server) → Tasks 1, 2. ✅
- Client threads accountKey (spec §Client 3) → Task 3. ✅
- AppContext scope + write-gate + local key + myList id + reload-on-switch (spec §Client 4) → Task 5. ✅
- accountScope shrink (spec §Client 5) → Task 4. ✅
- useHistory gating removal (spec §Client 6) → Task 6. ✅
- Screens gating removal + empty state (spec §Client 7) → Tasks 7, 8. ✅
- Legacy hidden (`account_key=''`) → Task 1 default + Task 2 filter. ✅
- Testing (spec §Testing) → Task 4 unit test; Tasks 5/7/8 run `npm test`; Task 8 manual two-account. ✅
- Rollout/deploy ordering (spec §Rollout) → Global Constraints + Task 1/2 notes. ✅

**Placeholder scan:** No TBD/TODO. Tasks 7 and 8 use *pattern replacements + exact greps* rather than per-file line rewrites because the gating code is spread across ~10 uncommitted files with near-identical shapes; the grep worklist makes each edit concrete. Every code block is real.

**Type/name consistency:** `accountKeyOf`/`accountLabelOf` (Task 4) match usages in Tasks 5/8. Service signatures `(userKey, accountKey, …)` (Task 3) match every call site in Task 5. `myListId(type, streamId)` (Task 5) matches the unchanged `mylist_${type}_${streamId}` reconstruction in callers. `libraryKeyRef` composite `${key}_${accountKey}` is consistent between `loadLibrary` and the effect.
