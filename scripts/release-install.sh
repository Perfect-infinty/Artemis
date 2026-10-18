#!/bin/bash
# Builds Artemis, installs it into /Applications and opens it again.
# Safe to start from inside Artemis (its terminal or the shell tool): the work is detached, so quitting the app does not stop it.
# Usage: bash scripts/release-install.sh      (progress goes to ~/.artemis/logs/release-install.log)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/.artemis/logs/release-install.log"
mkdir -p "$(dirname "$LOG")"

if [ "${ARTEMIS_RELEASE_CHILD:-}" != "1" ]; then
  ARTEMIS_RELEASE_CHILD=1 nohup bash "$0" >"$LOG" 2>&1 &
  echo "Started in the background (pid $!). Artemis will close, rebuild and open again. Log: $LOG"
  exit 0
fi

step() { echo; echo "== $(date '+%H:%M:%S') $*"; }
cd "$ROOT" || exit 1

step "Building (pnpm dist)"
if ! pnpm dist; then echo "BUILD FAILED: Artemis was left running."; exit 1; fi
APP="$(ls -d "$ROOT"/release/mac-arm64/Artemis.app "$ROOT"/release/mac/Artemis.app 2>/dev/null | head -1)"
[ -n "$APP" ] || { echo "Artemis.app was not found in release/."; exit 1; }

step "Copying the new build next to the installed app"
DEST=/Applications/Artemis.app
NEW="/Applications/.Artemis.app.new-$$"
OLD="/Applications/Artemis.app.old"
rm -rf "$NEW"
if ! cp -R "$APP" "$NEW"; then rm -rf "$NEW"; echo "Copy failed: Artemis was left as it was."; exit 1; fi
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null

step "Quitting Artemis"
# Ask nicely first (it saves chats on quit), wait up to 10 s, then TERM, then KILL.
osascript -e 'tell application "Artemis" to quit' 2>/dev/null
for i in $(seq 1 20); do pgrep -x Artemis >/dev/null || break; sleep 0.5; done
if pgrep -x Artemis >/dev/null; then pkill -TERM -x Artemis 2>/dev/null; sleep 2; fi
pgrep -x Artemis >/dev/null && { pkill -KILL -x Artemis 2>/dev/null; sleep 1; }

step "Installing into /Applications"
rm -rf "$OLD"
if [ -e "$DEST" ] && ! mv "$DEST" "$OLD"; then rm -rf "$NEW"; echo "Could not move the old app aside."; exit 1; fi
if ! mv "$NEW" "$DEST"; then
  echo "Install failed: restoring the previous app."
  [ -e "$OLD" ] && mv "$OLD" "$DEST"
  rm -rf "$NEW"; exit 1
fi
rm -rf "$OLD"

step "Opening"
open /Applications/Artemis.app
echo "Done."
