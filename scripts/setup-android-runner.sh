#!/usr/bin/env bash
#
# One-shot bootstrap for the self-hosted GitHub Actions runner that builds the
# Android APK locally (see .github/workflows/release.yml, job `android`).
#
# Run once on the Mac that should build:  ./scripts/setup-android-runner.sh
#
# Idempotent: re-running re-registers the runner (--replace) and refreshes the
# signing material. Requires the `gh` CLI authenticated with repo-admin scope
# (it mints the runner registration token for you — no manual copy-paste).
set -euo pipefail

REPO="AndrewHany2/suvo-player"
RUNNER_DIR="$HOME/actions-runner"
SIGNING_DIR="$HOME/.suvo-signing"
LABELS="suvo-android"                       # on top of the default self-hosted,macOS,ARM64
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { printf '\033[1;34m▸ %s\033[0m\n' "$1"; }

# ── Preconditions ────────────────────────────────────────────────────────────
command -v gh >/dev/null || { echo "gh CLI not found — install it first"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated — run: gh auth login"; exit 1; }

# ── 1. Signing material (source of truth the fresh CI checkout can't see) ──────
log "Staging signing material → $SIGNING_DIR"
mkdir -p "$SIGNING_DIR"
cp "$REPO_ROOT/android/keystore.properties"       "$SIGNING_DIR/"
cp "$REPO_ROOT/android/app/suvo-release.keystore" "$SIGNING_DIR/"

# ── 2. Download the runner (latest release, matching this Mac's arch) ──────────
OS="osx"
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported arch: $(uname -m)"; exit 1 ;;
esac
VER="$(gh api repos/actions/runner/releases/latest --jq '.tag_name' | sed 's/^v//')"
TARBALL="actions-runner-${OS}-${ARCH}-${VER}.tar.gz"

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [[ ! -x ./config.sh ]]; then
  log "Downloading runner v${VER} (${OS}-${ARCH})"
  curl -fSL -o "$TARBALL" \
    "https://github.com/actions/runner/releases/download/v${VER}/${TARBALL}"
  tar xzf "$TARBALL"
  rm -f "$TARBALL"
else
  log "Runner already extracted in $RUNNER_DIR — reusing"
fi

# ── 3. Register (unattended, with a freshly minted token) ──────────────────────
# Stop any prior service so --replace can rebind cleanly.
sudo ./svc.sh stop 2>/dev/null || true
log "Minting registration token via gh"
TOKEN="$(gh api -X POST "repos/${REPO}/actions/runners/registration-token" --jq '.token')"
log "Configuring runner (unattended)"
./config.sh \
  --url "https://github.com/${REPO}" \
  --token "$TOKEN" \
  --labels "$LABELS" \
  --unattended \
  --replace

# ── 4. Install + start as a background service (survives reboot) ───────────────
log "Installing + starting service"
sudo ./svc.sh install
sudo ./svc.sh start
./svc.sh status || true

log "Done. Runner is online with labels: self-hosted, macOS, ARM64, ${LABELS}"
echo "Verify at: https://github.com/${REPO}/settings/actions/runners"
