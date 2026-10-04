#!/bin/bash
# Stops the background Deskwork server started by deskwork.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5174}"
PID_FILE="${DATA_DIR:-$ROOT/data}/server.pid"

# The installed app runs the server as a background service; unload it so it doesn't restart.
# It starts again at the next login, or with scripts/start.sh.
if launchctl bootout "gui/$(id -u)/local.deskwork.server" 2>/dev/null; then
  echo "Background server stopped. It starts again at your next login, or run scripts/start.sh."
fi

pids=""
[ -f "$PID_FILE" ] && pids="$(cat "$PID_FILE")"
# Also catch a server started some other way (e.g. npm start) on the same port.
pids="$pids $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"

stopped=0
for pid in $pids; do
  if kill "$pid" 2>/dev/null; then stopped=1; fi
done
rm -f "$PID_FILE"
[ "$stopped" = 1 ] && echo "Deskwork server stopped." || echo "Deskwork server wasn't running."
