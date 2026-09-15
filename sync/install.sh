#!/bin/bash
# install.sh — set up the Nuqta session sync on this Mac.
# Creates ~/NuqtaSync, installs the reader, runs it once, and schedules it
# every 15 minutes. Everything stays local; nothing is uploaded by this script.
#
#   bash install.sh            install and start
#   bash install.sh uninstall  stop and remove the schedule

set -euo pipefail

LABEL="com.anwar.nuqta-sync"
SYNC_DIR="$HOME/NuqtaSync"
BIN_DIR="$SYNC_DIR/bin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Stopped and unscheduled. $SYNC_DIR was left alone — delete it yourself if you want it gone."
  exit 0
fi

if [ ! -d "$HOME/.claude/projects" ]; then
  echo "No ~/.claude/projects found. Open a Claude Code session at least once, then run this again."
  exit 1
fi

PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "python3 not found. Install it (xcode-select --install) and run this again."
  exit 1
fi

mkdir -p "$BIN_DIR"
cp "$SRC_DIR/nuqta_sync.py" "$BIN_DIR/nuqta_sync.py"
chmod +x "$BIN_DIR/nuqta_sync.py"

if [ ! -f "$SYNC_DIR/ignore.txt" ]; then
  mkdir -p "$SYNC_DIR"
  cat > "$SYNC_DIR/ignore.txt" <<'IGEOF'
# One substring per line. Any project whose path or name contains it is
# skipped. Scrapped projects keep their session history on disk forever,
# so list them here or they come back on the next sync.
IGEOF
fi

echo "Running once now..."
"$PY" "$BIN_DIR/nuqta_sync.py" "$SYNC_DIR/sessions.json"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$BIN_DIR/nuqta_sync.py</string>
    <string>$SYNC_DIR/sessions.json</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$SYNC_DIR/sync.log</string>
  <key>StandardErrorPath</key><string>$SYNC_DIR/sync.log</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

echo
echo "Done. It will refresh every 15 minutes."
echo "  data  $SYNC_DIR/sessions.json"
echo "  log   $SYNC_DIR/sync.log"
echo
echo "Last step, in the Claude desktop app: connect the folder $SYNC_DIR to this task"
echo "so Claude can read sessions.json."
