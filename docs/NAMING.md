# Product Naming Analysis

Research + clearance work to pick a shippable brand name for the app (cross-platform
streaming/media **player**: iOS, Android, web, Electron, LG webOS + Samsung Tizen TV).
The app plays user-supplied playlists/channels and **must be marketed without the word
"IPTV"** for store compliance.

## ✅ Decision: **Suvo**

The only candidate that is simultaneously **trademark-green**, **has an available domain**,
and **effortless to say/remember worldwide** — the three stacked requirements.

- **Pronounceability:** `SU-vo` — 2 syllables, open `-o` ending, soft `s`/`v` only, no
  clusters, no English-only sounds. Same mold as Roku / Vevo / Kodi; sayable in Spanish,
  Portuguese, Arabic, Hindi, Mandarin, French.
- **Trademark:** only "SUVO" marks are unrelated classes (metal hooks; abandoned e-cig
  filing). Nothing in Class 9/38/41/42 (software / broadcasting / entertainment / SaaS).
- **Domain:** `suvo.tv` confirmed **available** (RDAP via `rdap.nic.tv`); `suvo.com` shows
  no DNS records (likely free, `.com` RDAP unconfirmed in research env); `.app` is taken.
- **Trade-off:** coined / meaning-neutral (doesn't literally mean "light") — same choice
  Roku/Kodi/Vevo made; a clean slate that pairs with the aurora/signal visual identity.

**Before filing:** confirm `suvo.com` availability + SUVO trademark status via a paid
RDAP/TESS/Corsearch check across Classes 9, 38, 41, 42. The free USPTO databases were
WAF-blocked during research, so "no known conflict" is knowledge-based, not a DB lookup.

**Light-themed runner-up (amber):** `Rayu` (from *rayo*, "ray of light"; `rayu.tv` free) —
but a live Class 9 registration exists for Rayu-branded phone chargers (different goods,
likely defensible, not clean-green).

---

## Category naming rules (from research)

- **Winners are short coined single words:** Plex, Kodi, Roku, Emby, Jellyfin, VLC, mpv,
  Stremio, Infuse. Descriptive names get abandoned (Xbox Media Center → XBMC → **Kodi**).
- **Coined = most legally defensible.** Strength: coined/fanciful (Exxon) > arbitrary
  (Apple) > suggestive (Coppertone) > descriptive/generic (weak, often unregistrable).
- **Hard constraints:** avoid "IPTV" (non-compliant + "IPTVX" exists); avoid "Cinematic"
  (was Stremio's prototype name → shipping "Aurora Cinematic" verbatim is risky).
- **Apple rules:** unique name, ≤30 chars, no third-party trademarks in name/icon/metadata.
- **Frameworks:** aim SMILE (Suggestive, Memorable, Imagery, Legs, Emotional); avoid SCRATCH
  (Spelling-challenged, Copycat, Restrictive, Annoying, Tame, Curse-of-knowledge, Hard-to-say).
- **Never collide with:** Plex, Kodi, Roku, Emby, Jellyfin, Stremio, Infuse, VLC, mpv,
  PotPlayer, IPTVX.
- **TLD reality:** short `.com`s scarce/expensive → coined names are the affordable path.
  `.app` (Google Registry, HTTPS auto-enforced) is built for software; `.tv` reads as
  generic "streaming" to Google but is premium-priced.
- **Clearance tools:** `tmsearch.uspto.gov`, Namelix, Instant Domain Search, RDAP
  (`rdap.nic.tv`, Verisign RDAP for `.com`).

---

## Full clearance ledger (every name tested)

RDAP: `404 = available`, `200 = taken`. Trademark = related-class (9/38/41/42) conflicts only.

| Name | Theme | Verdict | Deciding evidence |
|------|-------|---------|-------------------|
| **Suvo** | coined | 🟢 **GREEN — CHOSEN** | No in-field TM; `suvo.tv` free; easy to say globally |
| Rayu | ray of light | 🟡 AMBER | `rayu.tv` free; live Class 9 TM (phone chargers, diff. goods) |
| Orbo | orbit | 🟡 CAUTION | No in-field TM (scooters/furniture only); pending Class 9 app; all domains taken (some grabbed within weeks) |
| Lumo | lumen (light) | 🟡 YELLOW | Proton "Lumo" AI assistant (2025), diff. class; domains likely taken |
| Beamo | beam | 🟡 YELLOW | FLUX laser cutter + 3i digital-twin app; diff. classes |
| Nira | light-ish | 🟡 YELLOW | Nira Inc. (3D SaaS, holds `.app`) + NIRA skincare; software overlap |
| Orbeon | orbit | 🔴 RED | **Orbeon Forms** — web-forms software (Class 9/42) |
| Auralite | aura+light | 🟡 domain-ok, audio connotation | `.app`+`.tv` free; only "Auralite-23" gemstone (unrelated); "aural"=audio, off for video |
| Lumveil | lumen+veil | 🟡 domain-ok, hard to say | `.app`+`.tv` free; no known brand; but hard for non-English speakers |
| Aurivo | aurora | 🟡 domain-ok | `.app`+`.tv` free; Irish dairy co-op (unrelated) |
| Vireon | vision | 🟡 | only `.tv` free; no known in-field brand |
| Signara | signal | 🟡 | only `.tv` free; no known in-field brand |
| Glim | glimmer (light) | 🔴 NO-GO | **Live registered TM "GLIM" — Telestream** (video/streaming software) + Reolink Class 9 |
| Sona | signal/sonar | 🟠 RISKY | Crowded; sona.audio (AI audio), Sona workforce app, Sona Systems |
| Lumora | lumen | 🔴 RED | Multiple direct video apps ("Lumora Short: Video Player", etc.) |
| Aurio | aurora | 🔴 RED | **"AURIO Player" is an HLS/M3U8 stream player** — exact product + software TMs |
| Miru | JP 見る "to watch" | 🔴 RED | miru.watch anime streaming, miru-project media app, manga viewer — in-category |
| Faro | lighthouse/beacon | 🔴 RED | **FARO Technologies** — ~82 Class 9 software/app marks |
| Solu | sol/light | 🔴 RED | Hear Now **SOLU** = "app for streaming audio content" (Class 9, 2025) |
| Lumi | lumen | 🔴 RED | Lumi streaming projector + LUMI (Class 9/entertainment, 2024) |
| Rayo | ray of light | 🟡 AMBER | J Balvin **RAYO** — Class 9 sound recordings + Class 41 (related) |
| Vela / Ravo / Soli / Luvi | coined | 🟡/🔴 | in-field Class 9 app/software marks or crowded |

### Key lesson
The category is **saturated**: every short, attractive, meaningful name is already occupied
in-field. A green name required a coined, meaning-neutral word (Suvo) — literal "light" names
(Lumi, Solu, Faro, Glim) all collided with existing Class 9 software/streaming brands.

---

## Verification notes

- Trademark databases (`tmsearch.uspto.gov` and mirrors justia/trademarkia/uspto.report)
  were WAF-blocked (HTTP 403) in the research environment — TM findings are knowledge/snippet
  based, not authoritative DB lookups. **Run a formal clearance before filing.**
- Domains verified via RDAP where reachable (`.tv` authoritative via `rdap.nic.tv`; `.app`
  via Google Registry bootstrap; `.com` RDAP intermittently unreachable → treat as unconfirmed).
- Research base: 123 extracted claims, 52/53 confirmed under 3-vote adversarial verification.
