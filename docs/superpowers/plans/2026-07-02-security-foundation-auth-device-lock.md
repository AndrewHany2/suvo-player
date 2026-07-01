# Security Foundation: Forced Auth + Server-Side Device Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app unusable without a Supabase login and bind each account to exactly one device, enforced server-side, on all platforms.

**Architecture:** The client stops talking to Supabase tables directly and calls two Edge Functions (`claim-device`, `data`) that run with the service role and enforce a `user_id`-primary-key `device_bindings` row. Access decisions run on a stable per-device *primary* anchor (UUID / iOS idForVendor / Android SSAID / Electron machine-id); a *secondary* composite fingerprint is stored for admin anomaly-spotting only. Native hardware attestation is a later plan; this plan uses the best non-attestation anchors and leaves a clean seam for it.

**Tech Stack:** Expo SDK 54 / React Native 0.81, `@supabase/supabase-js` v2, Supabase Edge Functions (Deno/TypeScript), Postgres + RLS, `expo-application`, `node --test`.

## Global Constraints

- **Device policy:** exactly 1 device per account, **permanent**, **admin-only unbind** (delete the `device_bindings` row).
- **No local fallback:** missing `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` → hard error screen; never local-only mode.
- **Access decision uses `primary` anchor only.** The `secondary` composite fingerprint is informational and MUST NOT gate access (avoids drift-induced lockouts).
- **Data functions run with `service_role`;** tables are not exposed to `anon`/`authenticated` after Task 10.
- **Auth stays on `supabase-js` `auth.*`;** only *data* access moves behind Edge Functions.
- Tests are plain `node --test` files named `*.test.js` co-located in `src/`.
- `platform` values: `ios | android | webos | tizen | electron`.

---

### Task 1: `device_bindings` table + RLS (locked to service role)

**Files:**
- Create: `supabase/migrations/20260702000001_device_bindings.sql`

**Interfaces:**
- Produces: table `public.device_bindings(user_id uuid PK, device_id text, platform text, label text, secondary_fp jsonb, attest_key_id text, attest_pubkey text, bound_at timestamptz, last_seen_at timestamptz)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260702000001_device_bindings.sql
create table if not exists public.device_bindings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  device_id     text not null,
  platform      text,
  label         text,
  secondary_fp  jsonb,
  attest_key_id text,
  attest_pubkey text,
  bound_at      timestamptz not null default now(),
  last_seen_at  timestamptz
);

alter table public.device_bindings enable row level security;
-- No anon/authenticated policies on purpose: reachable only via service_role Edge Functions.
revoke all on public.device_bindings from anon, authenticated;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db push` (or `supabase migration up` against the linked project).
Expected: migration applies; `select * from device_bindings;` in the SQL editor returns 0 rows with the columns above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260702000001_device_bindings.sql
git commit -m "feat(db): device_bindings table locked to service role"
```

---

### Task 2: Pure binding-decision logic (TDD)

The atomic INSERT lives in the Edge Function; the *decision* after it is pure and testable in isolation.

**Files:**
- Create: `src/security/bindingDecision.js`
- Test: `src/security/bindingDecision.test.js`

**Interfaces:**
- Produces: `evaluateBinding({ insertedRow, existingRow, callerDeviceId }) -> { status: 'bound'|'ok'|'denied' }`
  - `insertedRow` = the row returned by `INSERT ... ON CONFLICT DO NOTHING RETURNING *` (or `null` on conflict).
  - `existingRow` = the row re-selected when `insertedRow` is null (`{ device_id }`), else `null`.

- [ ] **Step 1: Write the failing test**

```js
// src/security/bindingDecision.test.js
const test = require('node:test');
const assert = require('node:assert');
const { evaluateBinding } = require('./bindingDecision.js');

test('binds when this login inserted the row', () => {
  const r = evaluateBinding({ insertedRow: { device_id: 'A' }, existingRow: null, callerDeviceId: 'A' });
  assert.strictEqual(r.status, 'bound');
});

test('ok when existing binding matches caller device', () => {
  const r = evaluateBinding({ insertedRow: null, existingRow: { device_id: 'A' }, callerDeviceId: 'A' });
  assert.strictEqual(r.status, 'ok');
});

test('denied when existing binding is a different device', () => {
  const r = evaluateBinding({ insertedRow: null, existingRow: { device_id: 'A' }, callerDeviceId: 'B' });
  assert.strictEqual(r.status, 'denied');
});

test('denied when caller device id is missing', () => {
  const r = evaluateBinding({ insertedRow: null, existingRow: { device_id: 'A' }, callerDeviceId: '' });
  assert.strictEqual(r.status, 'denied');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/security/bindingDecision.test.js`
Expected: FAIL — `Cannot find module './bindingDecision.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/security/bindingDecision.js
function evaluateBinding({ insertedRow, existingRow, callerDeviceId }) {
  if (insertedRow) return { status: 'bound' };
  if (!callerDeviceId) return { status: 'denied' };
  if (existingRow && existingRow.device_id === callerDeviceId) return { status: 'ok' };
  return { status: 'denied' };
}
module.exports = { evaluateBinding };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/security/bindingDecision.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/security/bindingDecision.js src/security/bindingDecision.test.js
git commit -m "feat(security): pure device-binding decision logic"
```

---

### Task 3: Secondary composite fingerprint (TDD, pure)

**Files:**
- Create: `src/security/secondaryFingerprint.js`
- Test: `src/security/secondaryFingerprint.test.js`

**Interfaces:**
- Produces:
  - `normalizeHints(hints) -> object` — drops `null`/`undefined`, lowercases strings, sorts keys.
  - `fingerprintHash(hints) -> string` — stable hex digest of `normalizeHints`. Order-independent.

- [ ] **Step 1: Write the failing test**

```js
// src/security/secondaryFingerprint.test.js
const test = require('node:test');
const assert = require('node:assert');
const { normalizeHints, fingerprintHash } = require('./secondaryFingerprint.js');

test('normalize drops empty values and sorts keys', () => {
  const out = normalizeHints({ b: 'X', a: null, c: 'y' });
  assert.deepStrictEqual(Object.keys(out), ['b', 'c']);
  assert.strictEqual(out.c, 'y');
});

test('hash is stable regardless of key order', () => {
  const h1 = fingerprintHash({ cpu: 'm1', cores: 8 });
  const h2 = fingerprintHash({ cores: 8, cpu: 'm1' });
  assert.strictEqual(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('different hints produce different hashes', () => {
  assert.notStrictEqual(fingerprintHash({ cpu: 'm1' }), fingerprintHash({ cpu: 'm2' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/security/secondaryFingerprint.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/security/secondaryFingerprint.js
// Uses Node/RN-safe hashing: expo-crypto in the app, but the pure function
// accepts an injected hasher for testability. Default hasher = sha256 hex.
const crypto = require('node:crypto');

function normalizeHints(hints) {
  const out = {};
  for (const key of Object.keys(hints || {}).sort()) {
    let v = hints[key];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'string') v = v.toLowerCase();
    out[key] = v;
  }
  return out;
}

function fingerprintHash(hints, hasher) {
  const json = JSON.stringify(normalizeHints(hints));
  if (hasher) return hasher(json);
  return crypto.createHash('sha256').update(json).digest('hex');
}

module.exports = { normalizeHints, fingerprintHash };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/security/secondaryFingerprint.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/security/secondaryFingerprint.js src/security/secondaryFingerprint.test.js
git commit -m "feat(security): stable secondary composite fingerprint"
```

---

### Task 4: Device signature module (client, per-platform)

**Files:**
- Create: `src/security/deviceSignature.js` (native — RN)
- Create: `src/security/deviceSignature.web.js` (web export: webOS/Tizen/Electron/browser)
- Test: `src/security/deviceSignature.web.test.js`
- Modify: `package.json` (add `expo-application`)

**Interfaces:**
- Consumes: `fingerprintHash` (Task 3).
- Produces: `async getDeviceSignature() -> { primary: string, platform: string, secondary: string }`
  - Native: `primary` = `Application.getIosIdForVendorAsync()` (iOS) / `Application.getAndroidId()` (Android); `platform` = `ios|android`.
  - Web export: `platform` derived (`electron` if `window.electronAPI?.machineId`, `tizen` if `window.tizen`, `webos` if `window.webOS`, else `webos` fallback for TV build / `browser`); `primary` = machine-id (Electron) or persisted UUID (`localStorage['iptv_device_uuid']`, created with `crypto.randomUUID()` if absent).

- [ ] **Step 1: Add dependency**

Run: `npx expo install expo-application`
Expected: `expo-application` added to `package.json` dependencies.

- [ ] **Step 2: Write the failing test (web branch, with injected globals)**

```js
// src/security/deviceSignature.web.test.js
const test = require('node:test');
const assert = require('node:assert');
const { detectPlatform, ensureUuid } = require('./deviceSignature.web.js');

test('detects electron when machineId bridge present', () => {
  assert.strictEqual(detectPlatform({ electronAPI: { machineId: 'm' } }), 'electron');
});
test('detects tizen', () => {
  assert.strictEqual(detectPlatform({ tizen: {} }), 'tizen');
});
test('detects webos', () => {
  assert.strictEqual(detectPlatform({ webOS: {} }), 'webos');
});
test('ensureUuid creates once then reuses', () => {
  const store = {};
  const fakeLs = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const a = ensureUuid(fakeLs, () => 'uuid-1');
  const b = ensureUuid(fakeLs, () => 'uuid-2');
  assert.strictEqual(a, 'uuid-1');
  assert.strictEqual(b, 'uuid-1'); // reused, generator not called again
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test src/security/deviceSignature.web.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the web branch**

```js
// src/security/deviceSignature.web.js
const { fingerprintHash } = require('./secondaryFingerprint.js');

function detectPlatform(g) {
  if (g?.electronAPI?.machineId) return 'electron';
  if (g?.tizen) return 'tizen';
  if (g?.webOS) return 'webos';
  return 'browser';
}

function ensureUuid(ls, gen) {
  const KEY = 'iptv_device_uuid';
  let v = ls.getItem(KEY);
  if (!v) { v = gen(); ls.setItem(KEY, v); }
  return v;
}

function collectHints(g) {
  const nav = g?.navigator || {};
  const scr = g?.screen || {};
  return {
    cores: nav.hardwareConcurrency,
    ram: nav.deviceMemory,
    ua: nav.userAgent,
    lang: nav.language,
    screen: scr.width && scr.height ? `${scr.width}x${scr.height}x${scr.colorDepth || ''}` : undefined,
    tizenDuid: g?.tizen?.systeminfo ? 'tizen' : undefined,
  };
}

async function getDeviceSignature() {
  const g = globalThis;
  const platform = detectPlatform(g);
  let primary;
  if (platform === 'electron') {
    primary = await g.electronAPI.machineId();
  } else {
    const gen = () => (g.crypto?.randomUUID ? g.crypto.randomUUID() : String(Date.now()) + Math.random());
    primary = ensureUuid(g.localStorage, gen);
  }
  const secondary = fingerprintHash(collectHints(g));
  return { primary, platform, secondary };
}

module.exports = { detectPlatform, ensureUuid, collectHints, getDeviceSignature };
```

- [ ] **Step 5: Implement the native branch**

```js
// src/security/deviceSignature.js
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { fingerprintHash } from './secondaryFingerprint.js';

export async function getDeviceSignature() {
  const platform = Platform.OS; // 'ios' | 'android'
  let primary;
  if (platform === 'ios') {
    primary = await Application.getIosIdForVendorAsync();
  } else {
    primary = Application.getAndroidId();
  }
  const secondary = fingerprintHash({
    os: platform,
    osVersion: Platform.Version,
    appVersion: Application.nativeApplicationVersion,
    build: Application.nativeBuildVersion,
  });
  return { primary: primary || 'unknown', platform, secondary };
}
```

- [ ] **Step 6: Run web test to verify it passes**

Run: `node --test src/security/deviceSignature.web.test.js`
Expected: PASS (4/4).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/security/deviceSignature.js src/security/deviceSignature.web.js src/security/deviceSignature.web.test.js
git commit -m "feat(security): per-platform device signature (primary anchor + secondary fp)"
```

---

### Task 5: Shared Edge Function device gate

**Files:**
- Create: `supabase/functions/_shared/deviceGate.ts`

**Interfaces:**
- Consumes: request headers `Authorization: Bearer <jwt>`, `x-device-id: <primary>`.
- Produces:
  - `getUserId(req, supabaseUrl, anonKey) -> Promise<string>` — throws `Unauthorized` if no valid user.
  - `assertBoundDevice(admin, userId, deviceId) -> Promise<void>` — throws `DEVICE_MISMATCH` if the user's bound device ≠ `deviceId`. No row (unbound) also throws `DEVICE_MISMATCH` (data access requires a prior `claim-device`).
  - `json(body, status)` — CORS-enabled `Response` helper.

- [ ] **Step 1: Write the shared helper**

```ts
// supabase/functions/_shared/deviceGate.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-device-id, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return null;
}

export async function getUserId(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) throw new Error('Unauthorized');
  return data.user.id;
}

export function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export async function assertBoundDevice(admin: ReturnType<typeof adminClient>, userId: string, deviceId: string) {
  if (!deviceId) throw new Error('DEVICE_MISMATCH');
  const { data, error } = await admin
    .from('device_bindings').select('device_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('SERVER_ERROR');
  if (!data || data.device_id !== deviceId) throw new Error('DEVICE_MISMATCH');
  await admin.from('device_bindings').update({ last_seen_at: new Date().toISOString() }).eq('user_id', userId);
}
```

- [ ] **Step 2: Verify it type-checks in Deno**

Run: `supabase functions serve --no-verify-jwt` (starts the local runtime; Ctrl-C after it boots without a TypeScript error on `_shared/deviceGate.ts`).
Expected: functions runtime starts with no compile error.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/deviceGate.ts
git commit -m "feat(edge): shared device-gate helper (auth + binding check)"
```

---

### Task 6: `claim-device` Edge Function

**Files:**
- Create: `supabase/functions/claim-device/index.ts`

**Interfaces:**
- Consumes: `getUserId`, `adminClient`, `json`, `corsPreflight` (Task 5); `evaluateBinding` logic mirrored server-side (Task 2 shape).
- Request body: `{ deviceId: string, platform: string, secondary?: string, label?: string }`.
- Produces: response `{ status: 'bound'|'ok'|'denied' }` (200 for bound/ok, 403 for denied).

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/claim-device/index.ts
import { getUserId, adminClient, json, corsPreflight } from '../_shared/deviceGate.ts';

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const { deviceId, platform, secondary, label } = await req.json();
    if (!deviceId) return json({ status: 'denied' }, 403);
    const admin = adminClient();

    // Atomic bind-or-nothing.
    const { data: inserted } = await admin
      .from('device_bindings')
      .upsert(
        { user_id: userId, device_id: deviceId, platform, secondary_fp: secondary ?? null, label: label ?? null },
        { onConflict: 'user_id', ignoreDuplicates: true },
      )
      .select('device_id')
      .maybeSingle();

    if (inserted) return json({ status: 'bound' });

    const { data: existing } = await admin
      .from('device_bindings').select('device_id').eq('user_id', userId).maybeSingle();

    if (existing && existing.device_id === deviceId) return json({ status: 'ok' });
    return json({ status: 'denied' }, 403);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'Unauthorized') return json({ error: 'Unauthorized' }, 401);
    return json({ error: 'SERVER_ERROR' }, 500);
  }
});
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy claim-device`
Expected: deploy succeeds.

- [ ] **Step 3: Verify bind + second-device denial with curl**

Run (substitute a real user JWT from a test login):
```bash
JWT="<access_token>"; URL="https://<ref>.functions.supabase.co/claim-device"
curl -s -XPOST $URL -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"deviceId":"dev-A","platform":"ios"}'         # -> {"status":"bound"}
curl -s -XPOST $URL -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"deviceId":"dev-A","platform":"ios"}'         # -> {"status":"ok"}
curl -s -XPOST $URL -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"deviceId":"dev-B","platform":"ios"}'         # -> {"status":"denied"} (HTTP 403)
```
Expected: `bound`, then `ok`, then `denied`. Delete the row in SQL editor to reset between runs.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/claim-device/index.ts
git commit -m "feat(edge): claim-device atomic bind-or-verify"
```

---

### Task 7: `data` Edge Function (action router, device-gated)

**Files:**
- Create: `supabase/functions/data/index.ts`

**Interfaces:**
- Consumes: `getUserId`, `adminClient`, `assertBoundDevice`, `json`, `corsPreflight` (Task 5).
- Request body: `{ action: string, payload?: object }`; header `x-device-id`.
- Produces: per-action results mirroring today's `supabase.js` return shapes:
  - `profiles.fetch` -> `{ username, email } | null`
  - `profiles.upsert` (payload `{ username, email }`) -> `{ ok: true }`
  - `appProfiles.list` -> `[{ id, name, avatar, created_at }]`
  - `appProfiles.insert` (`{ name, avatar }`) -> row
  - `appProfiles.update` (`{ id, name, avatar }`) -> `{ ok: true }`
  - `appProfiles.delete` (`{ id }`) -> `{ ok: true }`
  - `iptv.list` (`{ profileId }`) -> `[{ id, nickname, host, username, password }]`
  - `iptv.insert` (`{ profileId, nickname, host, username, password }`) -> `{ id }`
  - `iptv.update` (`{ id, nickname, host, username, password }`) -> `{ ok: true }`
  - `iptv.delete` (`{ id }`) -> `{ ok: true }`
  - `history.fetch` (`{ userKey }`) -> `[entry]`; `history.upsert` (`{ userKey, entry }`) -> `{ ok }`; `history.delete` (`{ userKey, entryId }`) -> `{ ok }`
  - `favorites.fetch` (`{ userKey }`) -> `[entry]`; `favorites.upsert` (`{ userKey, entry }`) -> `{ ok }`; `favorites.delete` (`{ userKey, entryId }`) -> `{ ok }`

- [ ] **Step 1: Write the router**

```ts
// supabase/functions/data/index.ts
import { getUserId, adminClient, assertBoundDevice, json, corsPreflight } from '../_shared/deviceGate.ts';

const MAX_HISTORY = 20;

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const admin = adminClient();
    await assertBoundDevice(admin, userId, req.headers.get('x-device-id') ?? '');
    const { action, payload = {} } = await req.json();
    const db = admin.from.bind(admin);

    switch (action) {
      case 'profiles.fetch': {
        const { data } = await db('profiles').select('username, email').eq('user_id', userId).maybeSingle();
        return json(data ?? null);
      }
      case 'profiles.upsert': {
        await db('profiles').upsert({ user_id: userId, username: payload.username, email: payload.email }, { onConflict: 'user_id' });
        return json({ ok: true });
      }
      case 'appProfiles.list': {
        const { data } = await db('app_profiles').select('id, name, avatar, created_at').eq('user_id', userId).order('created_at', { ascending: true });
        return json(data ?? []);
      }
      case 'appProfiles.insert': {
        const { data } = await db('app_profiles').insert({ user_id: userId, name: payload.name, avatar: payload.avatar ?? '👤' }).select().single();
        return json(data);
      }
      case 'appProfiles.update': {
        await db('app_profiles').update({ name: payload.name, avatar: payload.avatar }).eq('id', payload.id).eq('user_id', userId);
        return json({ ok: true });
      }
      case 'appProfiles.delete': {
        await db('app_profiles').delete().eq('id', payload.id).eq('user_id', userId);
        return json({ ok: true });
      }
      case 'iptv.list': {
        const { data } = await db('iptv_accounts').select('*').eq('profile_id', payload.profileId).order('created_at', { ascending: true });
        return json((data ?? []).map((r: any) => ({ id: r.id, nickname: r.nickname || '', host: r.host, username: r.username, password: r.password })));
      }
      case 'iptv.insert': {
        const { data } = await db('iptv_accounts').insert({
          user_id: userId, profile_id: payload.profileId, nickname: payload.nickname || null,
          host: payload.host, username: payload.username, password: payload.password,
        }).select('id').single();
        return json({ id: data?.id ?? null });
      }
      case 'iptv.update': {
        await db('iptv_accounts').update({ nickname: payload.nickname || null, host: payload.host, username: payload.username, password: payload.password }).eq('id', payload.id).eq('user_id', userId);
        return json({ ok: true });
      }
      case 'iptv.delete': {
        await db('iptv_accounts').delete().eq('id', payload.id).eq('user_id', userId);
        return json({ ok: true });
      }
      case 'history.fetch': {
        const { data } = await db('watch_history').select('entry').eq('user_key', payload.userKey).order('watched_at', { ascending: false }).limit(MAX_HISTORY);
        return json((data ?? []).map((r: any) => r.entry));
      }
      case 'history.upsert': {
        await db('watch_history').upsert({ user_key: payload.userKey, entry_id: payload.entry.id, entry: payload.entry, watched_at: payload.entry.watchedAt }, { onConflict: 'user_key,entry_id' });
        return json({ ok: true });
      }
      case 'history.delete': {
        await db('watch_history').delete().eq('user_key', payload.userKey).eq('entry_id', payload.entryId);
        return json({ ok: true });
      }
      case 'favorites.fetch': {
        const { data } = await db('favorites').select('entry').eq('user_key', payload.userKey).order('added_at', { ascending: false });
        return json((data ?? []).map((r: any) => r.entry));
      }
      case 'favorites.upsert': {
        await db('favorites').upsert({ user_key: payload.userKey, entry_id: payload.entry.id, entry: payload.entry, added_at: payload.entry.addedAt }, { onConflict: 'user_key,entry_id' });
        return json({ ok: true });
      }
      case 'favorites.delete': {
        await db('favorites').delete().eq('user_key', payload.userKey).eq('entry_id', payload.entryId);
        return json({ ok: true });
      }
      default:
        return json({ error: 'UNKNOWN_ACTION' }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'Unauthorized') return json({ error: 'Unauthorized' }, 401);
    if (msg === 'DEVICE_MISMATCH') return json({ error: 'DEVICE_MISMATCH' }, 403);
    return json({ error: 'SERVER_ERROR' }, 500);
  }
});
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy data`
Expected: deploy succeeds.

- [ ] **Step 3: Verify gate + one action with curl**

Run (with the bound `dev-A` from Task 6):
```bash
URL="https://<ref>.functions.supabase.co/data"
curl -s -XPOST $URL -H "Authorization: Bearer $JWT" -H 'x-device-id: dev-A' -H 'content-type: application/json' \
  -d '{"action":"appProfiles.list"}'                 # -> [] or rows (HTTP 200)
curl -s -XPOST $URL -H "Authorization: Bearer $JWT" -H 'x-device-id: dev-B' -H 'content-type: application/json' \
  -d '{"action":"appProfiles.list"}'                 # -> {"error":"DEVICE_MISMATCH"} (HTTP 403)
```
Expected: 200 for `dev-A`, 403 `DEVICE_MISMATCH` for `dev-B`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/data/index.ts
git commit -m "feat(edge): device-gated data action router"
```

---

### Task 8: Rewrite client `supabase.js` data calls to `functions.invoke`

**Files:**
- Modify: `src/services/supabase.js`
- Create: `src/services/deviceHeader.js`
- Test: `src/services/invokeData.test.js`

**Interfaces:**
- Consumes: `getDeviceSignature` (Task 4); `client()` (existing).
- Produces:
  - `setDeviceId(id)` / `getDeviceId()` in `deviceHeader.js` — module-level cache of the primary anchor set once at boot.
  - `invokeData(action, payload) -> Promise<any>` — wraps `client().functions.invoke('data', { body, headers:{ 'x-device-id': getDeviceId() } })`, throws `Error('DEVICE_MISMATCH')` on 403.
  - `claimDevice({ deviceId, platform, secondary }) -> Promise<'bound'|'ok'|'denied'>`.
  - All existing data functions (`fetchAppProfiles`, `insertAppProfile`, … `fetchFavorites`, etc.) keep their **names and signatures** but now call `invokeData`.

- [ ] **Step 1: Write the failing test for `invokeData` error mapping**

```js
// src/services/invokeData.test.js
const test = require('node:test');
const assert = require('node:assert');
const { mapInvokeResult } = require('./invokeData.logic.js');

test('returns data on success', () => {
  assert.deepStrictEqual(mapInvokeResult({ data: [1, 2], error: null }), [1, 2]);
});
test('throws DEVICE_MISMATCH when body signals it', () => {
  assert.throws(() => mapInvokeResult({ data: { error: 'DEVICE_MISMATCH' }, error: null }), /DEVICE_MISMATCH/);
});
test('throws generic on transport error', () => {
  assert.throws(() => mapInvokeResult({ data: null, error: { message: 'boom' } }), /boom/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/invokeData.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure mapper**

```js
// src/services/invokeData.logic.js
function mapInvokeResult({ data, error }) {
  if (error) throw new Error(error.message || 'REQUEST_FAILED');
  if (data && data.error === 'DEVICE_MISMATCH') throw new Error('DEVICE_MISMATCH');
  if (data && data.error) throw new Error(data.error);
  return data;
}
module.exports = { mapInvokeResult };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/invokeData.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Add `deviceHeader.js` and `invokeData` + `claimDevice` to `supabase.js`**

```js
// src/services/deviceHeader.js
let _deviceId = null;
export function setDeviceId(id) { _deviceId = id; }
export function getDeviceId() { return _deviceId || ''; }
```

Add to `src/services/supabase.js` (import the mapper and header, then add helpers):

```js
import { mapInvokeResult } from './invokeData.logic.js';
import { getDeviceId } from './deviceHeader.js';

async function invokeData(action, payload = {}) {
  if (!client()) throw new Error('Supabase not configured');
  const res = await client().functions.invoke('data', {
    body: { action, payload },
    headers: { 'x-device-id': getDeviceId() },
  });
  return mapInvokeResult(res);
}

export async function claimDevice({ deviceId, platform, secondary }) {
  if (!client()) throw new Error('Supabase not configured');
  const res = await client().functions.invoke('claim-device', {
    body: { deviceId, platform, secondary },
    headers: { 'x-device-id': deviceId },
  });
  if (res.error) throw new Error(res.error.message || 'CLAIM_FAILED');
  return res.data?.status ?? 'denied';
}
```

- [ ] **Step 6: Replace each data function body with an `invokeData` call**

Replace the bodies (keep exported names/signatures). Examples — apply the same pattern to all:

```js
export async function fetchAppProfiles() { return invokeData('appProfiles.list'); }
export async function insertAppProfile(_userId, { name, avatar = '👤' }) { return invokeData('appProfiles.insert', { name, avatar }); }
export async function updateAppProfile(profileId, { name, avatar }) { return invokeData('appProfiles.update', { id: profileId, name, avatar }); }
export async function deleteAppProfile(profileId) { return invokeData('appProfiles.delete', { id: profileId }); }

export async function fetchIptvAccounts(profileId) { return invokeData('iptv.list', { profileId }); }
export async function insertIptvAccount(_userId, profileId, account) { const r = await invokeData('iptv.insert', { profileId, ...account }); return r?.id ?? null; }
export async function updateIptvAccount(accountId, account) { return invokeData('iptv.update', { id: accountId, ...account }); }
export async function deleteIptvAccount(accountId) { return invokeData('iptv.delete', { id: accountId }); }

export async function fetchProfile(_userId) { return invokeData('profiles.fetch'); }
export async function upsertProfile(_userId, username, email) { return invokeData('profiles.upsert', { username, email }); }

export async function fetchRemoteHistory(userKey) { return invokeData('history.fetch', { userKey }); }
export async function upsertHistoryEntry(userKey, entry) { try { await invokeData('history.upsert', { userKey, entry }); return { ok: true }; } catch (e) { return { ok: false, error: e }; } }
export async function deleteHistoryEntry(userKey, entryId) { try { await invokeData('history.delete', { userKey, entryId }); return { ok: true }; } catch (e) { return { ok: false, error: e }; } }

export async function fetchFavorites(userKey) { return invokeData('favorites.fetch', { userKey }); }
export async function upsertFavorite(userKey, entry) { try { await invokeData('favorites.upsert', { userKey, entry }); return { ok: true }; } catch (e) { return { ok: false, error: e }; } }
export async function deleteFavorite(userKey, entryId) { try { await invokeData('favorites.delete', { userKey, entryId }); return { ok: true }; } catch (e) { return { ok: false, error: e }; } }
```

Keep `mergeHistories`, `MAX_HISTORY`, and all `auth.*` functions (`signIn`, `signUp`, `signOut`, `getSession`, `onAuthStateChange`) unchanged. Delete the now-unused username-uniqueness `.from('profiles')` pre-check in `signUp` (that read is gone with direct table access) — move the uniqueness check into a `profiles.upsert` server response later; for now rely on the `auth.signUp` unique-email guarantee.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (existing tests + new ones).

- [ ] **Step 8: Commit**

```bash
git add src/services/supabase.js src/services/deviceHeader.js src/services/invokeData.logic.js src/services/invokeData.test.js
git commit -m "feat(client): route data access through device-gated Edge Function"
```

---

### Task 9: Force auth + wire device claim into boot; remove local fallback; locked screen

**Files:**
- Modify: `src/context/AppContext.jsx`
- Modify: `src/navigation/AppNavigator.jsx` and `src/navigation/AppNavigator.web.jsx`
- Create: `src/screens/DeviceLockedScreen.jsx`
- Create: `src/screens/ConfigErrorScreen.jsx`

**Interfaces:**
- Consumes: `getDeviceSignature` (Task 4), `setDeviceId` (Task 8), `claimDevice` (Task 8), `isSupabaseConfigured` (existing).
- Produces: `AppContext` exposes `deviceStatus: 'pending'|'ok'|'denied'`; navigator renders `ConfigErrorScreen` when unconfigured, `AuthScreen` when no user, `DeviceLockedScreen` when `deviceStatus==='denied'`.

- [ ] **Step 1: Add device-claim effect to `AppContext.jsx`**

After the auth state is known and `authUser` is set, add:

```jsx
import { getDeviceSignature } from '../security/deviceSignature';
import { setDeviceId } from '../services/deviceHeader';
import { claimDevice } from '../services/supabase';
// ...
const [deviceStatus, setDeviceStatus] = useState('pending');

useEffect(() => {
  let cancelled = false;
  if (!authUser) { setDeviceStatus('pending'); return; }
  (async () => {
    try {
      const sig = await getDeviceSignature();
      setDeviceId(sig.primary);
      const status = await claimDevice({ deviceId: sig.primary, platform: sig.platform, secondary: sig.secondary });
      if (!cancelled) setDeviceStatus(status === 'denied' ? 'denied' : 'ok');
    } catch {
      if (!cancelled) setDeviceStatus('denied');
    }
  })();
  return () => { cancelled = true; };
}, [authUser]);
```

Export `deviceStatus` in the context value object.

- [ ] **Step 2: Remove local-fallback branches in `AppContext.jsx`**

Delete every `if (!isSupabaseConfigured())` local-storage write branch and the `authUser && isSupabaseConfigured()` guards (they become unconditional, since config is now mandatory and auth is required). Concretely: in `createProfile`/`updateProfile`/`deleteProfile`/`addUser`/`updateUser`/`removeUser`, drop the `!isSupabaseConfigured()` local `storage.setItem('iptv_profiles'/...)` authority paths, and change `if (authUser && isSupabaseConfigured())` to `if (authUser)`. Keep AsyncStorage writes that act purely as an offline cache of remote data (history/favorites cache), not as identity authority.

- [ ] **Step 3: Create the two gate screens**

```jsx
// src/screens/ConfigErrorScreen.jsx
import { YStack, Text } from '../ui/primitives';
import { colors } from '../ui/tokens';
export default function ConfigErrorScreen() {
  return (
    <YStack flex={1} alignItems="center" justifyContent="center" padding={24} backgroundColor={colors.bg}>
      <Text color={colors.danger} fontSize={18} fontWeight="700" textAlign="center">Configuration error</Text>
      <Text color={colors.muted} fontSize={14} textAlign="center" marginTop={8}>
        This build is missing its backend configuration. Please reinstall from the official store.
      </Text>
    </YStack>
  );
}
```

```jsx
// src/screens/DeviceLockedScreen.jsx
import { YStack, Text } from '../ui/primitives';
import Button from '../ui/Button';
import { colors } from '../ui/tokens';
import { useApp } from '../context/AppContext';
export default function DeviceLockedScreen() {
  const { signOut } = useApp();
  return (
    <YStack flex={1} alignItems="center" justifyContent="center" padding={24} gap={16} backgroundColor={colors.bg}>
      <Text color={colors.text} fontSize={20} fontWeight="700" textAlign="center">Device locked</Text>
      <Text color={colors.muted} fontSize={14} textAlign="center">
        This account is already active on another device. Contact support to switch devices.
      </Text>
      <Button variant="primary" size="lg" onPress={signOut}>Sign out</Button>
    </YStack>
  );
}
```

- [ ] **Step 4: Update both navigators to render the gates**

In `src/navigation/AppNavigator.jsx` (and mirror in `AppNavigator.web.jsx`), replace the top gates:

```jsx
import ConfigErrorScreen from '../screens/ConfigErrorScreen';
import DeviceLockedScreen from '../screens/DeviceLockedScreen';
// ...
export default function AppNavigator() {
  const { authUser, authLoading, activeProfileId, deviceStatus } = useApp();
  if (!isSupabaseConfigured()) return <ConfigErrorScreen />;
  if (authLoading) return (/* existing spinner */);
  if (!authUser) return <AuthScreen />;
  if (deviceStatus === 'pending') return (/* existing spinner */);
  if (deviceStatus === 'denied') return <DeviceLockedScreen />;
  if (!activeProfileId) return <ProfilesScreen />;
  return (/* existing NavigationContainer ... */);
}
```

- [ ] **Step 5: Run tests + boot the web app**

Run: `npm test` then `npm run web`
Expected: tests pass; app boots to `AuthScreen`; after login on a fresh account it binds (`deviceStatus='ok'`) and reaches profiles; simulate denial by pre-binding the account to another device id in SQL, reload → `DeviceLockedScreen`.

- [ ] **Step 6: Commit**

```bash
git add src/context/AppContext.jsx src/navigation/AppNavigator.jsx src/navigation/AppNavigator.web.jsx src/screens/DeviceLockedScreen.jsx src/screens/ConfigErrorScreen.jsx
git commit -m "feat(app): force auth, claim device on boot, config-error + device-locked gates"
```

---

### Task 10: Revoke direct table access (the flip) + end-to-end verification

**Files:**
- Create: `supabase/migrations/20260702000002_revoke_table_grants.sql`

**Interfaces:**
- Produces: `anon`/`authenticated` can no longer read/write the protected tables directly; all access is via the two Edge Functions.

- [ ] **Step 1: Write the revoke migration**

```sql
-- supabase/migrations/20260702000002_revoke_table_grants.sql
revoke all on public.profiles       from anon, authenticated;
revoke all on public.app_profiles   from anon, authenticated;
revoke all on public.iptv_accounts  from anon, authenticated;
revoke all on public.watch_history  from anon, authenticated;
revoke all on public.favorites      from anon, authenticated;
-- RLS remains enabled as defense-in-depth; the Edge Functions use service_role.
```

- [ ] **Step 2: Apply**

Run: `supabase db push`
Expected: applies cleanly.

- [ ] **Step 3: Verify direct access is dead but the app still works**

Run:
```bash
# direct table read with the anon key + user JWT should now fail:
curl -s "https://<ref>.supabase.co/rest/v1/iptv_accounts?select=*" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT"     # -> permission denied / empty, NOT data
```
Then in the running app (`npm run web`), confirm profiles, accounts, history, and favorites all still load and mutate (they now flow through the `data` function).
Expected: direct REST read is denied; app functions normally on the bound device.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260702000002_revoke_table_grants.sql
git commit -m "feat(db): revoke direct table grants — data access is functions-only"
```

---

## Self-Review

**Spec coverage (§ of the design doc):**
- §5A forced auth / no fallback → Tasks 9 (fallback removal, ConfigErrorScreen).
- §5B functions-only API → Tasks 5–8, 10.
- §5C device binding + claim-device → Tasks 1, 2, 6, 9.
- §6 data model → Task 1.
- §7 layered signature (primary + secondary) → Tasks 3, 4 (secondary is informational; access uses `primary` only — enforced in Tasks 6/7 which compare `device_id` only).
- §5F locked-device UX → Task 9.
- §5D obfuscation, §5E jailbreak, §5C native attestation → **out of scope for this plan** (Plans 2–4), as stated in the header.

**Placeholder scan:** no TBD/TODO; every code step has complete code; curl/SQL verification steps have concrete expected output.

**Type consistency:** `getDeviceSignature() -> { primary, platform, secondary }` used consistently in Tasks 4, 8, 9. `claimDevice({deviceId,platform,secondary}) -> status` and `invokeData(action,payload)` names match across Tasks 8, 9. `evaluateBinding` shape (Task 2) mirrors the server logic in Task 6. `assertBoundDevice` compares `device_id` only (Task 5), consistent with §7 "primary decides access."

**Known follow-ups (not gaps — deferred by design):** username-uniqueness pre-check removed in Task 8 Step 6 should be reinstated as a server-side check in a later plan; native `primary` anchor is upgraded to attestation in Plan 2.
