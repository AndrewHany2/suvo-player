# LG UX Scenario Document — generator

Regenerates `../Lumen_Player_UX_Scenario.pptx`, the app walk-through LG Content
Store QA requires (LG's own `ux_scenario_document_4.4.ppt` template, filled in
for Lumen Player and framed as a generic BYO-playlist media player — no channel
logos, no "IPTV / free TV" wording, so it doesn't trip a store rejection).

## Regenerate

```bash
cd tv/packaging/lg/ux-scenario
pip3 install Pillow           # once
npm install pptxgenjs         # once (or rely on repo node_modules)
python3 prep-images.py        # crops screenshots + copies brand art -> ./img
node build.js                 # -> ../Lumen_Player_UX_Scenario.pptx
```

## Files

| File | Purpose |
|------|---------|
| `prep-images.py` | Crops the content-free auth/profile screenshots (`../screenshots/0{1,2,3}-*.png`) to their card region and copies the logo/mark from `assets/`. Output → `./img/` (git-ignored). |
| `build.js` | Renders the deck with pptxgenjs. Real screenshots on the login/register/profile slides; shape-only wireframes for Home/Browse/A–Z/Accounts/Player (no real content). |
| `censor.py` | Sanitises the content-bearing screenshots (`../screenshots/05..11`): repaints every poster tile as the app's own blank "no-artwork" placeholder, blanks channel-name captions, and masks the playlist URLs on the Accounts screen. Output → `../screenshots/clean/*-clean.png`. Use these instead of the raw shots anywhere a reviewer might see them — the raw ones carry broadcaster logos (Pluto/CBS/MTV) and Free-TV/IPTV URLs that are rejection triggers. |
| `img/` | Generated inputs — not committed. |
| `../Lumen_Player_UX_Scenario.pptx` | The deliverable to upload to Seller Lounge. |

## Censor the content screenshots

```bash
python3 censor.py    # ../screenshots/clean/*-clean.png
```
Per-image tile geometry is auto-detected (tiles are brighter than the gaps); sparse layouts and the Accounts URL boxes are configured explicitly in `CFG` / `censor_accounts()`.

## Before submitting

Slide 8 ("Test Accounts for QA") has amber fill-in fields: replace them with a
real test account (email + password) and a sample M3U/Xtream playlist URL so LG
QA can exercise playback. Everything else is submission-ready.

## Preview / QA

```bash
soffice --headless --convert-to pdf ../Lumen_Player_UX_Scenario.pptx
pdftoppm -jpeg -r 110 Lumen_Player_UX_Scenario.pdf slide   # slide-01.jpg …
```
