# Obfuscation Phase C — Client Secret-Hardening Implementation Plan

> **For agentic workers:** Both tasks touch native (expo-secure-store) or server (Edge Function) surfaces that could NOT be verified in the authoring environment. Each is code-complete in its edits, but acceptance = an on-device build (C1) / a deployed Edge Function + a built bundle grep (C2). Steps use checkbox (`- [ ]`) tracking.

**Goal:** Remove the two real client-side secret exposures — the Supabase session sitting in plaintext AsyncStorage on native, and the TMDB API key inlined into the shipped bundle.

**Architecture:** C1 wraps the Supabase session in an expo-secure-store adapter (Keychain/Keystore) with 2 KB-chunking + one-time migration from AsyncStorage. C2 moves TMDB calls behind a Supabase Edge Function that holds the key server-side, so no TMDB secret ships in the client.

**Tech Stack:** expo-secure-store, @supabase/supabase-js auth storage adapter, Supabase Edge Functions (Deno), node:test.

**Scope note:** Phase C of the program in `docs/superpowers/specs/2026-07-17-obfuscation-anti-tamper-layers-design.md`. IPTV credentials are already server-side (via the `data` Edge Function — no local plaintext), so they are NOT in scope. The Supabase **anon/publishable key stays in the client** — it is designed to be public; RLS + the Edge Functions are the boundary (that's Phase D). "Build-time secret encryption" of embedded constants is deliberately NOT pursued: once TMDB is proxied there is no remaining real client secret to encrypt, and encrypting the public anon key is theatre.

## Global Constraints

- JavaScript only in app code (.js/.jsx), Node 20; Edge Functions are Deno TypeScript under `supabase/functions/`. Pure logic in `*.logic.js`/plain modules with `*.test.js` beside them, run via `npm test`.
- `npm test` + `npm run lint` green before each commit.
- **Web must keep working unchanged.** expo-secure-store is native-only; on web, Supabase must keep its default (localStorage) storage — do NOT route web through the SecureStore adapter.
- **No user gets logged out by C1.** The migration must move an existing AsyncStorage session into SecureStore transparently on first launch.
- SecureStore hard limit: values >2048 bytes warn/fail — a Supabase session JSON (access+refresh JWT + user) routinely exceeds this, so the adapter MUST chunk.
- Bar-raising only — see the spec's honest-ceiling note. The real boundary is Phase D (server entitlements).

---

### Task C1: Store the Supabase session in expo-secure-store (native)

**Files:**
- Create: `src/services/secureSessionStorage.js` (the chunking + migration adapter)
- Create: `src/services/secureSessionStorage.test.js`
- Modify: `src/services/supabase.js` (use the adapter as `auth.storage` on native)
- Modify: `package.json` (add `expo-secure-store`) — run `npx expo install expo-secure-store`

**Interfaces:**
- Consumes: injected `{ secureStore, asyncStore }` for testing; in the app, real `expo-secure-store` + `@react-native-async-storage/async-storage`.
- Produces: `createSecureSessionStorage({ secureStore, asyncStore })` → `{ getItem(key), setItem(key, value), removeItem(key) }` (all async), matching the Supabase storage interface. Chunks values across `${key}` (metadata: chunk count) + `${key}.0..N` at ≤1800 bytes each; migrates a legacy AsyncStorage value on a SecureStore miss.

- [ ] **Step 1: Write the failing adapter test.** `src/services/secureSessionStorage.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
// Adapter is ESM-in-app but the pure factory is required here via a small shim;
// if the repo runs app modules through babel in tests, import instead. Match the
// repo's existing *.test.js module style for src/services (see loginResult.logic.test.js).
const { createSecureSessionStorage } = require("./secureSessionStorage.js");

function fakeStore() {
  const m = new Map();
  return {
    _m: m,
    getItemAsync: async (k) => (m.has(k) ? m.get(k) : null),
    setItemAsync: async (k, v) => void m.set(k, v),
    deleteItemAsync: async (k) => void m.delete(k),
  };
}
function fakeAsync() {
  const m = new Map();
  return { _m: m, getItem: async (k) => (m.has(k) ? m.get(k) : null), removeItem: async (k) => void m.delete(k), setItem: async (k, v) => void m.set(k, v) };
}

test("round-trips a value larger than the 2KB SecureStore limit via chunking", async () => {
  const secureStore = fakeStore();
  const s = createSecureSessionStorage({ secureStore, asyncStore: fakeAsync() });
  const big = "x".repeat(5000);
  await s.setItem("sess", big);
  assert.strictEqual(await s.getItem("sess"), big);
  // stored as multiple chunks, none over the limit
  for (const [k, v] of secureStore._m) if (k !== "sess") assert.ok(v.length <= 1800, `${k} too big`);
});

test("removeItem clears every chunk", async () => {
  const secureStore = fakeStore();
  const s = createSecureSessionStorage({ secureStore, asyncStore: fakeAsync() });
  await s.setItem("sess", "y".repeat(4000));
  await s.removeItem("sess");
  assert.strictEqual(await s.getItem("sess"), null);
  assert.strictEqual(secureStore._m.size, 0);
});

test("migrates a legacy AsyncStorage value on a SecureStore miss, then clears the old copy", async () => {
  const secureStore = fakeStore();
  const asyncStore = fakeAsync();
  await asyncStore.setItem("sess", "legacy-token");
  const s = createSecureSessionStorage({ secureStore, asyncStore });
  assert.strictEqual(await s.getItem("sess"), "legacy-token"); // read-through migration
  assert.strictEqual(await asyncStore.getItem("sess"), null);  // old copy cleared
  assert.strictEqual(await s.getItem("sess"), "legacy-token"); // now served from SecureStore
});
```

- [ ] **Step 2: Run it — RED.** `node --test src/services/secureSessionStorage.test.js` → fails (module missing).

- [ ] **Step 3: Implement `src/services/secureSessionStorage.js`:**

```js
// expo-secure-store adapter for the Supabase auth session. SecureStore rejects
// values >2048 bytes, and a session JSON exceeds that, so chunk at 1800 bytes.
// One-time read-through migration moves a legacy plaintext AsyncStorage session
// into SecureStore so existing users are not logged out. Native-only — web keeps
// Supabase's default localStorage (see supabase.js).
const CHUNK = 1800;

export function createSecureSessionStorage({ secureStore, asyncStore }) {
  const meta = (key) => `${key}`;                 // stores the chunk count
  const part = (key, i) => `${key}.${i}`;

  async function readSecure(key) {
    const countRaw = await secureStore.getItemAsync(meta(key));
    if (countRaw == null) return null;
    const count = parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    let out = "";
    for (let i = 0; i < count; i++) {
      const c = await secureStore.getItemAsync(part(key, i));
      if (c == null) return null; // corrupt/partial — treat as miss
      out += c;
    }
    return out;
  }

  async function clearSecure(key) {
    const countRaw = await secureStore.getItemAsync(meta(key));
    const count = countRaw ? parseInt(countRaw, 10) : 0;
    for (let i = 0; i < count; i++) await secureStore.deleteItemAsync(part(key, i));
    await secureStore.deleteItemAsync(meta(key));
  }

  return {
    async getItem(key) {
      const hit = await readSecure(key);
      if (hit != null) return hit;
      // migration: legacy plaintext AsyncStorage session
      if (asyncStore) {
        const legacy = await asyncStore.getItem(key);
        if (legacy != null) {
          await this.setItem(key, legacy);
          await asyncStore.removeItem(key);
          return legacy;
        }
      }
      return null;
    },
    async setItem(key, value) {
      await clearSecure(key);
      const chunks = Math.ceil(value.length / CHUNK) || 1;
      for (let i = 0; i < chunks; i++) {
        await secureStore.setItemAsync(part(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      await secureStore.setItemAsync(meta(key), String(chunks));
    },
    async removeItem(key) {
      await clearSecure(key);
    },
  };
}
```

- [ ] **Step 4: GREEN.** `node --test src/services/secureSessionStorage.test.js` → 3/3 pass.

- [ ] **Step 5: Wire it in `src/services/supabase.js`.** Add `expo-secure-store` (`npx expo install expo-secure-store`). Replace the native `authConfig` so `storage` is the adapter (native only; web stays default):

```js
import * as SecureStore from "expo-secure-store";
import { createSecureSessionStorage } from "./secureSessionStorage.js";

const authConfig =
  Platform.OS !== "web"
    ? {
        auth: {
          storage: createSecureSessionStorage({ secureStore: SecureStore, asyncStore: AsyncStorage }),
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      }
    : {};
```

- [ ] **Step 6: Gate.** `npm test && npm run lint` green.

- [ ] **Step 7: THE REAL CHECK (on-device).** Build a native app that already has a logged-in AsyncStorage session (i.e. install the OLD build, log in, then install THIS build). On launch the user must STILL be logged in (migration worked), and after a force-quit + relaunch the session must persist (SecureStore read works). Verify on both iOS and Android if possible.

- [ ] **Step 8: Commit** `src/services/secureSessionStorage.js(+test)`, `src/services/supabase.js`, `package.json`, `package-lock.json` with the on-device migration result noted.

---

### Task C2: Proxy TMDB through an Edge Function (remove the key from the bundle)

**Files:**
- Create: `supabase/functions/tmdb/index.ts`
- Modify: `src/services/tmdbApi.js`
- Modify: `.env` / EAS env — remove `EXPO_PUBLIC_TMDB_API_KEY` from the client; add `TMDB_API_KEY` as a Supabase function secret.

**Context:** all TMDB access is centralized in `src/services/tmdbApi.js` (`TMDB_BASE = 'https://api.themoviedb.org/3'`, `API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY`, fetches like `${TMDB_BASE}/${type}/top_rated?api_key=${API_KEY}&page=${page}`). Only `top_rated` (and adjacent read-only discover/detail) endpoints are used.

- [ ] **Step 1: Write the Edge Function** `supabase/functions/tmdb/index.ts` — a thin, allow-listed read-only proxy:
  - Reads `TMDB_API_KEY` from `Deno.env.get("TMDB_API_KEY")`.
  - Accepts a constrained request (e.g. `{ path: "movie/top_rated", query: { page: 2 } }`), **allow-lists** `path` against the exact set the app uses (reject anything else — no open proxy), injects `api_key`, fetches `https://api.themoviedb.org/3/<path>`, returns the JSON.
  - `verify_jwt`: this is public catalog metadata; either require the app JWT (consistent with `data`) or leave `verify_jwt=false` if you want it pre-login. Match whatever `top_rated` prefetch timing needs. Register the choice in `supabase/config.toml`.
  - Mirror the structure/CORS of an existing function (e.g. `supabase/functions/data/index.ts`).

- [ ] **Step 2: Repoint `src/services/tmdbApi.js`** to call the function via `supabase.functions.invoke("tmdb", { body: { path, query } })` instead of fetching `api.themoviedb.org` directly. Delete the `API_KEY`/`EXPO_PUBLIC_TMDB_API_KEY` reference. Keep the existing match/paging logic — only the transport changes. If any pure paging/matching logic exists, keep its tests passing.

- [ ] **Step 3: Set the secret + deploy.** `supabase secrets set TMDB_API_KEY=<key> --project-ref <ref>`; `supabase functions deploy tmdb --project-ref <ref>`. Remove `EXPO_PUBLIC_TMDB_API_KEY` from `.env` and the EAS env.

- [ ] **Step 4: Gate.** `npm test && npm run lint` green.

- [ ] **Step 5: THE REAL CHECK.**
  - Functional: run the app (web is fine — `npm run web`), open Movies/Series; the **Top-Rated shelf must still populate** (proves the proxy works end-to-end).
  - Secret gone: `npm run build:web` then `grep -r "EXPO_PUBLIC_TMDB_API_KEY\|<the key value>" dist/` → **no matches** (the key no longer ships). Also confirm no `api_key=` TMDB URL is built client-side.

- [ ] **Step 6: Commit** `supabase/functions/tmdb/index.ts`, `supabase/config.toml`, `src/services/tmdbApi.js` (+ any test) with the shelf-populates + no-key-in-bundle results noted. Rotate the old TMDB key afterwards (it shipped in prior builds).

---

## Verification summary

| Task | Acceptance check |
|---|---|
| C1 SecureStore session | on-device: existing session survives the upgrade (no logout) + persists across relaunch; web unchanged |
| C2 TMDB proxy | Top-Rated shelf still populates; `grep dist/` shows the key no longer ships; old key rotated |

## Out of scope / rejected
- Build-time encryption of the Supabase anon key — it's a publishable key by design; encrypting it is theatre.
- IPTV credentials — already server-side, no local plaintext.
- Any change to the Phase D server-entitlement boundary (separate plan).
