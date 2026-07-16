# Suvo Reseller Dashboard

A standalone Vite + React + TypeScript web app for resellers and the
super-admin to manage IPTV provider accounts. It is a **separate package**
from the React Native player app that lives at the repo root — different
stack (TS, not `.js`), different build tool (Vite, not Metro/Expo), and it
ships independently as a static site.

The dashboard talks to Supabase directly for auth (`signInWithPassword`) and
to the `admin` Supabase Edge Function (`supabase/functions/admin`) for every
account/provider/device management action.

## Run locally

```bash
npm install
cp .env.example .env   # then fill in the two variables below
npm run dev
```

Required environment variables (`.env`):

| Variable                  | Description                                  |
| -------------------------- | --------------------------------------------- |
| `VITE_SUPABASE_URL`        | Your Supabase project URL                     |
| `VITE_SUPABASE_ANON_KEY`   | Your Supabase project's anon/public API key   |

Sign-in requires an existing Supabase Auth user whose `profiles.role` is
`reseller` or `super_admin` — the `customer` role is rejected by the app's
auth gate. There is no admin user by default; see **One-time super-admin
bootstrap** below.

## Test

```bash
npm test
```

Runs the Vitest suite (`vitest run`) covering the pure logic modules: the
API client (`src/api.ts`), the auth role gate (`src/authGate.ts`), the
formatting helpers (`src/lib/format.ts`), and the create-account line payload
builder (`src/lib/linePayload.ts`). Component/screen rendering is verified
manually rather than with component tests (see the task briefs under
`.superpowers/sdd/`).

## Build

```bash
npm run build
```

Type-checks (`tsc -b`) and bundles to `dist/`. Preview the production build
locally with `npm run preview`.

## Deploy

`dist/` is a static site — deploy it to any static host (Netlify, Vercel,
S3 + CloudFront, GitHub Pages, etc.). No server runtime is required.

**Important:** Vite inlines `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
into the bundle at **build time**, not at runtime. Set both in your host's
build-time environment (e.g. Netlify/Vercel project environment variables)
before running `npm run build` — changing them afterwards requires a rebuild
and redeploy, not just a config change.

## One-time super-admin bootstrap

The dashboard has no way to create the first super-admin from the UI — every
action goes through the `admin` Edge Function, which itself requires an
existing super-admin/reseller session. The one-time SQL to promote a user to
`super_admin` lives in [`supabase/README.md`](../supabase/README.md); run it
once against your Supabase project, then sign in to the dashboard with that
user.
