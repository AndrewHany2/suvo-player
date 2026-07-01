# Multi-Platform Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single GitHub Actions workflow that produces downloadable release artifacts for Android, Web, Desktop (Win/mac/Linux), webOS TV, and (dispatch-only) iOS simulator.

**Architecture:** One `.github/workflows/release.yml`. A `setup` job derives the version and selected platform; each platform is an independent job gated by an `if:` condition and reusing existing npm build scripts; a tag-only `release` job gathers artifacts and publishes a GitHub Release. Mobile builds (Android, iOS) run on EAS cloud via `EXPO_TOKEN`; everything else builds on GitHub-hosted runners.

**Tech Stack:** GitHub Actions, EAS CLI (`eas-cli`), electron-builder, `@webosose/ares-cli`, `gh` CLI, Node 20.

## Global Constraints

- Workflow file path: `.github/workflows/release.yml` (single file).
- Node version on all runners: `20` (matches local `v20.20.2`; project is Expo 54 / RN 0.81).
- Dependency install: always `npm ci` (lockfile `package-lock.json` exists).
- Only secret available: `EXPO_TOKEN` (used by `android` and `ios` jobs). `GITHUB_TOKEN` is auto-provided to `release`.
- iOS is **dispatch-only** (option B): its `if:` is `needs.setup.outputs.platform == 'ios'` — never part of `all` or tag releases, and it is NOT in the `release` job's `needs`.
- No source-code changes; reuse existing scripts: `build:web`, `build:electron`, `build:tv`.
- Artifact naming: `iptv-player-android-<ver>.apk`, `iptv-player-web-<ver>.zip`, `iptv-player-<ver>.ipk`, `iptv-player-ios-SIMULATOR-<ver>.tar.gz`; desktop keeps electron-builder's native names (`.dmg`/`.exe`/`.AppImage`).
- Version: tag push → tag minus leading `v`; dispatch → `app.json` version + `-<short-sha>`.
- Validation tool: `actionlint` (downloaded to repo root as `./actionlint`, git-ignored).

## File Structure

- Create: `.github/workflows/release.yml` — the entire pipeline.
- Modify: `eas.json` — add APK build type to `preview`, add a `simulator` profile.
- Modify: `.gitignore` — ignore the downloaded `actionlint` binary.
- Reference (unchanged): `package.json` scripts, `electron/builder.json`, `tv/patch-index.js`, `tv/packaging/lg/`.

---

## Task 1: EAS profile config for APK + iOS simulator

**Files:**
- Modify: `eas.json`

**Interfaces:**
- Produces: EAS profile `preview` emitting an installable Android **APK**; EAS profile `simulator` producing an unsigned iOS simulator archive. The `android` job runs `eas build -p android --profile preview`; the `ios` job runs `eas build -p ios --profile simulator`.

- [ ] **Step 1: Read the current file**

Run: `cat eas.json` — confirm it matches the pre-edit content below (the `preview` block currently only sets `ios.resourceClass`).

- [ ] **Step 2: Replace `eas.json` with the updated config**

Write `eas.json` exactly as:

```json
{
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "resourceClass": "m-medium"
      }
    },
    "simulator": {
      "distribution": "internal",
      "ios": {
        "simulator": true
      }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('eas.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 4: Confirm the two new keys exist**

Run: `node -e "const e=require('./eas.json').build; console.log(e.preview.android.buildType, '|', e.simulator.ios.simulator)"`
Expected: `apk | true`

- [ ] **Step 5: Commit**

```bash
git add eas.json
git commit -m "chore(eas): add APK preview build type and iOS simulator profile"
```

---

## Task 2: Workflow scaffold — triggers, concurrency, setup job

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: job `setup` with outputs `version` (string), `is_tag` (`"true"`/`"false"`), and `platform` (one of `all|android|web|desktop|tv|ios`). Every platform job declares `needs: setup` and reads `needs.setup.outputs.*`.

- [ ] **Step 1: Add the actionlint binary to `.gitignore`**

Append this line to `.gitignore`:

```gitignore
/actionlint
```

- [ ] **Step 2: Create `.github/workflows/release.yml` with the scaffold**

```yaml
name: Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      platform:
        description: Platform to build
        type: choice
        default: all
        options: [all, android, web, desktop, tv, ios]

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.ver.outputs.version }}
      is_tag: ${{ steps.ver.outputs.is_tag }}
      platform: ${{ steps.ver.outputs.platform }}
    steps:
      - uses: actions/checkout@v4
      - id: ver
        shell: bash
        run: |
          if [[ "${GITHUB_REF}" == refs/tags/v* ]]; then
            echo "version=${GITHUB_REF#refs/tags/v}" >> "$GITHUB_OUTPUT"
            echo "is_tag=true" >> "$GITHUB_OUTPUT"
          else
            APPVER=$(node -p "require('./app.json').expo.version")
            echo "version=${APPVER}-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
            echo "is_tag=false" >> "$GITHUB_OUTPUT"
          fi
          PLAT="${{ github.event.inputs.platform }}"
          if [[ -z "$PLAT" ]]; then PLAT="all"; fi
          echo "platform=${PLAT}" >> "$GITHUB_OUTPUT"
      - name: Show resolved values
        run: |
          echo "version=${{ steps.ver.outputs.version }}"
          echo "is_tag=${{ steps.ver.outputs.is_tag }}"
          echo "platform=${{ steps.ver.outputs.platform }}"
```

- [ ] **Step 3: Download actionlint**

Run:
```bash
bash <(curl -s https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)
```
Expected: creates `./actionlint` in the repo root and prints a version line.

- [ ] **Step 4: Validate the workflow**

Run: `./actionlint .github/workflows/release.yml`
Expected: no output, exit code 0. (If it reports "shellcheck not found" warnings only, that is acceptable; there must be no errors about the workflow schema.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml .gitignore
git commit -m "ci(release): scaffold workflow triggers and version setup job"
```

---

## Task 3: Web job

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `needs.setup.outputs.version`, `needs.setup.outputs.platform`.
- Produces: uploaded artifact named `web` containing `iptv-player-web-<ver>.zip`.

- [ ] **Step 1: Append the `web` job** (inside `jobs:`, after `setup`)

```yaml
  web:
    needs: setup
    if: needs.setup.outputs.platform == 'all' || needs.setup.outputs.platform == 'web'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build:web
      - name: Zip web bundle
        run: cd dist && zip -r "../iptv-player-web-${{ needs.setup.outputs.version }}.zip" .
      - uses: actions/upload-artifact@v4
        with:
          name: web
          path: iptv-player-web-*.zip
          if-no-files-found: error
```

- [ ] **Step 2: Validate the workflow**

Run: `./actionlint .github/workflows/release.yml`
Expected: exit code 0, no schema errors.

- [ ] **Step 3: Reproduce the web build locally (sanity check)**

Run: `npm run build:web && test -d dist && ls dist | head`
Expected: `dist/` exists and contains an `index.html` and `_expo/` (or similar). This proves the underlying script the job calls actually works.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add web build job"
```

---

## Task 4: Android job (EAS APK)

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `needs.setup.outputs.version`, `needs.setup.outputs.platform`, secret `EXPO_TOKEN`, EAS `preview` profile (Task 1).
- Produces: uploaded artifact named `android` containing `iptv-player-android-<ver>.apk`.

- [ ] **Step 1: Append the `android` job**

```yaml
  android:
    needs: setup
    if: needs.setup.outputs.platform == 'all' || needs.setup.outputs.platform == 'android'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Install EAS CLI
        run: npm i -g eas-cli
      - name: Build APK on EAS
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          eas build -p android --profile preview --non-interactive --wait --json > build.json
          URL=$(node -e "const b=JSON.parse(require('fs').readFileSync('build.json','utf8'))[0]; const a=b.artifacts||{}; process.stdout.write(a.applicationArchiveUrl||a.buildUrl||'')")
          if [[ -z "$URL" ]]; then echo "No artifact URL in EAS response"; cat build.json; exit 1; fi
          curl -L -o "iptv-player-android-${{ needs.setup.outputs.version }}.apk" "$URL"
      - uses: actions/upload-artifact@v4
        with:
          name: android
          path: iptv-player-android-*.apk
          if-no-files-found: error
```

- [ ] **Step 2: Validate the workflow**

Run: `./actionlint .github/workflows/release.yml`
Expected: exit code 0, no schema errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add android EAS APK build job"
```

> Note: this job can only be validated end-to-end on GitHub (needs `EXPO_TOKEN` + EAS cloud). It is exercised in Task 8.

---

## Task 5: Desktop job (Electron matrix)

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `needs.setup.outputs.platform`.
- Produces: three uploaded artifacts `desktop-macos-latest`, `desktop-windows-latest`, `desktop-ubuntu-latest`, each holding the OS-native installer (`.dmg` / `.exe` / `.AppImage`) from `electron/release/`.

- [ ] **Step 1: Append the `desktop` job**

```yaml
  desktop:
    needs: setup
    if: needs.setup.outputs.platform == 'all' || needs.setup.outputs.platform == 'desktop'
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: false
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build:electron
      - uses: actions/upload-artifact@v4
        with:
          name: desktop-${{ matrix.os }}
          path: |
            electron/release/*.dmg
            electron/release/*.exe
            electron/release/*.AppImage
          if-no-files-found: error
```

- [ ] **Step 2: Validate the workflow**

Run: `./actionlint .github/workflows/release.yml`
Expected: exit code 0, no schema errors.

- [ ] **Step 3: Reproduce the desktop build locally for this OS (macOS)**

Run: `npm run build:electron && ls electron/release/*.dmg`
Expected: at least one `.dmg` file exists. (This validates the macOS matrix leg; Windows/Linux legs are validated on GitHub in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add desktop electron matrix build job"
```

---

## Task 6: TV job (webOS IPK)

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `needs.setup.outputs.version`, `needs.setup.outputs.platform`.
- Produces: uploaded artifact named `tv` containing `iptv-player-<ver>.ipk`.

- [ ] **Step 1: Append the `tv` job**

```yaml
  tv:
    needs: setup
    if: needs.setup.outputs.platform == 'all' || needs.setup.outputs.platform == 'tv'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Install webOS CLI
        run: npm i -g @webosose/ares-cli
      - name: Build TV bundle
        run: npm run build:tv
      - name: Package IPK
        run: |
          cp -r tv/dist/* tv/packaging/lg/
          ares-package tv/packaging/lg -o tv/packaging/lg/out
      - name: Rename IPK
        run: |
          IPK=$(ls tv/packaging/lg/out/*.ipk | head -n1)
          cp "$IPK" "iptv-player-${{ needs.setup.outputs.version }}.ipk"
      - uses: actions/upload-artifact@v4
        with:
          name: tv
          path: iptv-player-*.ipk
          if-no-files-found: error
```

- [ ] **Step 2: Validate the workflow**

Run: `./actionlint .github/workflows/release.yml`
Expected: exit code 0, no schema errors.

- [ ] **Step 3: Reproduce the TV bundle build locally (macOS with webOS SDK)**

Run: `npm run build:tv && test -f tv/dist/index.html && echo "tv bundle ok"`
Expected: `tv bundle ok`. (Full `ares-package` is also validated on GitHub in Task 8; local run confirms the bundle step the job depends on.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add webOS TV IPK build job"
```

---

## Task 7: iOS job (dispatch-only simulator) + tag `release` job

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes (ios): secret `EXPO_TOKEN`, EAS `simulator` profile (Task 1), `needs.setup.outputs.version`, `needs.setup.outputs.platform`.
- Consumes (release): artifacts from `android`, `web`, `desktop`, `tv`; `needs.setup.outputs.is_tag`.
- Produces (ios): uploaded artifact `ios-simulator` containing `iptv-player-ios-SIMULATOR-<ver>.tar.gz`.
- Produces (release): a GitHub Release for the tag with all available artifacts attached. iOS is intentionally excluded from `release.needs` (dispatch-only).

- [ ] **Step 1: Append the `ios` job**

```yaml
  ios:
    needs: setup
    if: needs.setup.outputs.platform == 'ios'
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Install EAS CLI
        run: npm i -g eas-cli
      - name: Build iOS simulator (unsigned)
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          eas build -p ios --profile simulator --non-interactive --wait --json > build.json
          URL=$(node -e "const b=JSON.parse(require('fs').readFileSync('build.json','utf8'))[0]; const a=b.artifacts||{}; process.stdout.write(a.applicationArchiveUrl||a.buildUrl||'')")
          if [[ -z "$URL" ]]; then echo "No artifact URL in EAS response"; cat build.json; exit 1; fi
          curl -L -o "iptv-player-ios-SIMULATOR-${{ needs.setup.outputs.version }}.tar.gz" "$URL"
      - uses: actions/upload-artifact@v4
        with:
          name: ios-simulator
          path: iptv-player-ios-SIMULATOR-*.tar.gz
          if-no-files-found: error
```

- [ ] **Step 2: Append the `release` job**

```yaml
  release:
    needs: [setup, android, web, desktop, tv]
    if: always() && needs.setup.outputs.is_tag == 'true'
    runs-on: ubuntu-latest
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
      - name: Collect release assets
        run: |
          mkdir -p release-assets
          find artifacts -type f \( \
            -name '*.apk' -o -name '*.zip' -o -name '*.dmg' \
            -o -name '*.exe' -o -name '*.AppImage' -o -name '*.ipk' \) \
            -exec cp {} release-assets/ \;
          echo "Assets to publish:"; ls -la release-assets
          if [[ -z "$(ls -A release-assets)" ]]; then
            echo "No artifacts were produced by any build job"; exit 1
          fi
      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          TAG="${GITHUB_REF#refs/tags/}"
          if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            gh release upload "$TAG" release-assets/* --repo "$GITHUB_REPOSITORY" --clobber
          else
            gh release create "$TAG" release-assets/* \
              --repo "$GITHUB_REPOSITORY" --title "$TAG" --generate-notes
          fi
```

- [ ] **Step 3: Validate the workflow**

Run: `./actionlint .github/workflows/release.yml`
Expected: exit code 0, no schema errors.

- [ ] **Step 4: Confirm iOS is excluded from the release job's needs**

Run: `grep -A1 'release:' .github/workflows/release.yml | grep 'needs:'`
Expected: a `needs: [setup, android, web, desktop, tv]` line with **no** `ios` entry.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add dispatch-only iOS simulator job and tag release publisher"
```

---

## Task 8: End-to-end validation on GitHub

**Files:** none (operational validation).

**Interfaces:**
- Consumes: everything above; repo secret `EXPO_TOKEN` must be set first.

- [ ] **Step 1: Set the `EXPO_TOKEN` secret** (one-time, manual)

Generate a token at https://expo.dev/settings/access-tokens, then:
```bash
gh secret set EXPO_TOKEN --repo AndrewHany2/iptv-player
```
Paste the token when prompted. Verify:
```bash
gh secret list --repo AndrewHany2/iptv-player
```
Expected: `EXPO_TOKEN` appears in the list.

- [ ] **Step 2: Push the branch and open a PR (or merge to main)**

```bash
git push -u origin ci/release-pipeline
```
The workflow only runs from the default branch's tags / dispatch once merged. Merge `ci/release-pipeline` into `main` before triggering (workflow_dispatch and tags resolve against the default branch).

- [ ] **Step 3: Dispatch a single cheap platform first (web)**

```bash
gh workflow run release.yml --repo AndrewHany2/iptv-player -f platform=web
gh run watch --repo AndrewHany2/iptv-player
```
Expected: the `setup` and `web` jobs succeed; `web` uploads `iptv-player-web-<ver>.zip`. Download it:
```bash
gh run download --repo AndrewHany2/iptv-player -n web
```
Expected: the zip downloads and unzips to a working web bundle.

- [ ] **Step 4: Dispatch each remaining platform individually**

```bash
gh workflow run release.yml --repo AndrewHany2/iptv-player -f platform=tv
gh workflow run release.yml --repo AndrewHany2/iptv-player -f platform=desktop
gh workflow run release.yml --repo AndrewHany2/iptv-player -f platform=android
gh workflow run release.yml --repo AndrewHany2/iptv-player -f platform=ios
```
Expected per run:
- `tv` → `iptv-player-<ver>.ipk` artifact.
- `desktop` → three artifacts (`desktop-macos-latest`, `desktop-windows-latest`, `desktop-ubuntu-latest`) with `.dmg`/`.exe`/`.AppImage`.
- `android` → `iptv-player-android-<ver>.apk`; confirm it installs on an Android device.
- `ios` → `iptv-player-ios-SIMULATOR-<ver>.tar.gz` (drag the extracted `.app` into an iOS Simulator to confirm it launches).

- [ ] **Step 5: Cut a test release tag and verify the full flow**

```bash
git tag v0.0.1-test
git push origin v0.0.1-test
gh run watch --repo AndrewHany2/iptv-player
```
Expected: all `all`-gated jobs run (android, web, desktop, tv — NOT ios), and the `release` job creates a GitHub Release `v0.0.1-test` with the APK, web zip, three desktop installers, and the IPK attached. Confirm:
```bash
gh release view v0.0.1-test --repo AndrewHany2/iptv-player
```

- [ ] **Step 6: Clean up the test release and tag**

```bash
gh release delete v0.0.1-test --repo AndrewHany2/iptv-player --yes
git push origin :refs/tags/v0.0.1-test
git tag -d v0.0.1-test
```
Expected: the test release and tag are gone.

---

## Self-Review Notes

- **Spec coverage:** trigger/structure → Task 2; per-platform jobs → Tasks 3–7; `eas.json` changes → Task 1; iOS option B (dispatch-only, excluded from `release.needs`) → Task 7 Steps 1/4; error isolation (`fail-fast: false`, `if: always()`) → Tasks 5 & 7; validation → Task 8. All spec sections mapped.
- **Placeholders:** none — every step has concrete YAML/commands and expected output.
- **Type/name consistency:** `setup` outputs (`version`, `is_tag`, `platform`) are referenced identically in all jobs; artifact names match between upload steps and the `release` job's `find` filter (`*.apk *.zip *.dmg *.exe *.AppImage *.ipk`).
