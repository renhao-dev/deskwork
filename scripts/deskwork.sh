#!/bin/bash
# Starts the Deskwork server in the background (if it isn't running yet) and opens the app in Chrome.
# Safe to run any number of times. Used by Deskwork.app, and can be run directly from a terminal.
#
#   PORT=5174                  port to serve on
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5174}"
URL="http://localhost:$PORT"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
LOG="$DATA_DIR/server.log"
PID_FILE="$DATA_DIR/server.pid"
AGENT_LABEL=local.deskwork.server
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
GUI="gui/$(id -u)"

# Apps started from Launchpad get a bare PATH, so add the usual Node locations.
export PATH="${DESKWORK_NODE_DIR:+$DESKWORK_NODE_DIR:}/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() {
  echo "Deskwork: $1" >&2
  # Show the problem even when there's no terminal (launched from Launchpad).
  osascript -e "display alert \"Deskwork can't start\" message \"$1\" as critical" >/dev/null 2>&1 || true
  exit 1
}

healthy() { curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; }

newer_than() { # any file under the given dirs newer than $1?
  local ref="$1"; shift
  [ ! -e "$ref" ] && return 0
  [ -n "$(find "$@" -type f -newer "$ref" -print -quit 2>/dev/null)" ]
}

mkdir -p "$DATA_DIR"
cd "$ROOT"

command -v node >/dev/null || fail "Node.js was not found. Install Node 24 or newer (for example: brew install node)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || fail "Deskwork needs Node 24 or newer; found $(node -v)."

# First run, or dependencies changed.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "Installing dependencies…"
  npm install --no-audit --no-fund >>"$LOG" 2>&1 || fail "npm install failed. See $LOG"
  touch node_modules
fi

# Rebuild the web app when its sources changed since the last build (project folder only;
# the installed copy ships prebuilt).
if [ -d web/src ] && newer_than web/dist/index.html web/src web/index.html shared; then
  echo "Building the web app…"
  npm run build >>"$LOG" 2>&1 || fail "Building the web app failed. See $LOG"
fi

if [ -f "$AGENT_PLIST" ] && [ -n "${DESKWORK_LAUNCHER:-}" ]; then
  # Installed app: the background service owns the server. Make sure it's loaded and running.
  if ! healthy; then
    echo "Starting the background server…"
    launchctl bootstrap "$GUI" "$AGENT_PLIST" 2>/dev/null || launchctl kickstart -k "$GUI/$AGENT_LABEL" 2>/dev/null || true
  fi
else
  # Project folder: run the server directly, restarting it when its code changed since it started.
  if healthy && [ -f "$PID_FILE" ] && newer_than "$PID_FILE" server shared; then
    echo "Server code changed, restarting…"
    "$ROOT/scripts/stop.sh" >/dev/null || true
  fi
  if ! healthy; then
    echo "Starting the server on ${URL}…"
    PORT="$PORT" DATA_DIR="$DATA_DIR" nohup node --no-warnings=ExperimentalWarning server/index.ts >>"$LOG" 2>&1 &
    echo $! >"$PID_FILE"
    disown || true
  fi
fi
for _ in $(seq 1 60); do
  healthy && break
  sleep 0.25
done
healthy || fail "The server didn't start. See $LOG"

# Prefer Deskwork installed as a Chrome app: its own window, Dock icon and Cmd+Tab entry.
CHROME_APP="$(ls -d "$HOME/Applications/Chrome Apps.localized/Deskwork.app" "$HOME/Applications/Chrome Apps/Deskwork.app" 2>/dev/null | head -1 || true)"
if [ -n "$CHROME_APP" ]; then
  open "$CHROME_APP"
  if [ -n "${DESKWORK_LAUNCHER:-}" ]; then
    # This launcher is no longer needed; remove it so Launchpad shows a single Deskwork icon.
    LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
    for app in /Applications/Deskwork.app "$HOME/Applications/Deskwork.app"; do
      [ -d "$app" ] && { "$LSREGISTER" -u "$app" 2>/dev/null || true; rm -rf "$app"; echo "Retired launcher $app"; }
    done
  fi
  echo "Deskwork is running at $URL"
  exit 0
fi

CHROME="/Applications/Google Chrome.app"
[ -d "$CHROME" ] || CHROME="$HOME/Applications/Google Chrome.app"
if [ -d "$CHROME" ]; then
  # A normal window, not a chromeless --app one: Chrome only offers "Install app" in normal windows.
  open -na "$CHROME" --args --new-window "$URL"
else
  open "$URL" # no Chrome: use the default browser
fi
echo "Deskwork is running at $URL"
