#!/usr/bin/env bash
#
# deploy.sh — build the production AppImage and install it for the
# local desktop launcher.
#
#   npm run dist  ->  release/You-<version>.AppImage
#                 ->  ~/Applications/You.AppImage   (launcher target)
#
# Usage:  scripts/deploy.sh        (or: npm run deploy)

set -euo pipefail

# ── paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd -- "$ROOT"

APP_NAME="You"
APP_DIR="${HOME}/Applications"
DEST="${APP_DIR}/${APP_NAME}.AppImage"
ICON_SRC="build/icon.png"
ICON_DEST="${HOME}/.local/share/icons/hicolor/512x512/apps/you.png"

say() { printf '\033[1;36m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── build ───────────────────────────────────────────────────────────────────
say "Building production bundle (npm run dist)…"
npm run dist

# ── locate the freshly built image ──────────────────────────────────────────
# Newest You-*.AppImage by mtime, so a stale artifact can't win the glob.
BUILT="$(ls -1t release/"${APP_NAME}"-*.AppImage 2>/dev/null | head -n1 || true)"
[ -n "${BUILT:-}" ] || die "no ${APP_NAME}-*.AppImage produced in release/"

# ── install (write then swap, so a half-copied file never lands) ────────────
mkdir -p -- "$APP_DIR"
say "Installing $(basename -- "$BUILT") → $DEST"
install -m 0755 -- "$BUILT" "${DEST}.new"
mv -f -- "${DEST}.new" "$DEST"

# ── keep launcher icon in sync with the build ───────────────────────────────
if [ -f "$ICON_SRC" ]; then
  mkdir -p -- "$(dirname -- "$ICON_DEST")"
  install -m 0644 -- "$ICON_SRC" "$ICON_DEST"
fi

# ── refresh the desktop database ────────────────────────────────────────────
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
fi

ok "Deployed ${APP_NAME} → $DEST"
say "Relaunch ${APP_NAME} from your applications menu to pick up the change."
