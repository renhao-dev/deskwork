#!/bin/bash
# Starts the Deskwork server again after scripts/stop.sh (it also starts by itself at login).
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/local.deskwork.server.plist"
if [ -f "$PLIST" ]; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/local.deskwork.server"
  echo "Deskwork server started."
else
  # Not installed as a Mac app: run it from the project folder instead.
  exec "$(dirname "${BASH_SOURCE[0]}")/deskwork.sh"
fi
