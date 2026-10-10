#!/bin/bash
# Installs Deskwork on this Mac:
#   - a copy of the built app in ~/Library/Application Support/Deskwork
#   - a background service (LaunchAgent) that runs the server from login on and restarts it if it crashes
#   - Deskwork.app in Applications (Launchpad, Spotlight) that opens it in Chrome. Once you click
#     "Install app" inside Deskwork, Chrome's own Deskwork app takes over and this launcher retires.
#
# The app runs from Application Support rather than this project folder because macOS blocks apps
# from reading ~/Documents, ~/Desktop and ~/Downloads without a privacy permission.
# Run this script again after changing the code to update the installed app.
#
#   scripts/install-mac.sh              install or update
#   scripts/install-mac.sh --uninstall  remove the app (your data is kept)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPPORT="$HOME/Library/Application Support/Deskwork"
RUNTIME="$SUPPORT/app"
DATA="$SUPPORT/data"
PORT="${PORT:-5174}"
if [ -w /Applications ]; then DEST_DIR=/Applications; else DEST_DIR="$HOME/Applications"; fi
APP="$DEST_DIR/Deskwork.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
AGENT_LABEL=local.deskwork.server
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
GUI="gui/$(id -u)"

stop_server() {
  launchctl bootout "$GUI/$AGENT_LABEL" >/dev/null 2>&1 || true
  PORT="$PORT" DATA_DIR="$DATA" "$ROOT/scripts/stop.sh" >/dev/null 2>&1 || true
}

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

if [ "${1:-}" = "--uninstall" ]; then
  stop_server
  for app in /Applications/Deskwork.app "$HOME/Applications/Deskwork.app"; do
    if [ -d "$app" ]; then
      "$LSREGISTER" -u "$app" 2>/dev/null || true
      rm -rf "$app"
      echo "Removed $app"
    fi
  done
  rm -f "$AGENT_PLIST"
  echo "Removed the background server"
  rm -rf "$RUNTIME"
  echo "Removed $RUNTIME"
  echo "Your data is kept in $DATA (delete that folder to remove it too)."
  exit 0
fi

command -v node >/dev/null || { echo "Node.js not found. Install Node 24+ first (brew install node)." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || { echo "Deskwork needs Node 24+; found $(node -v)." >&2; exit 1; }
NODE_DIR="$(dirname "$(command -v node)")"

echo "Building…"
cd "$ROOT"
npm install --no-audit --no-fund
npm run build

stop_server

echo "Copying the app to ${RUNTIME}…"
mkdir -p "$RUNTIME" "$DATA"
rsync -a --delete "$ROOT/server" "$ROOT/shared" "$ROOT/scripts" "$ROOT/package.json" "$ROOT/package-lock.json" "$RUNTIME/"
mkdir -p "$RUNTIME/web"
rsync -a --delete "$ROOT/web/dist" "$RUNTIME/web/"
# Only the server's runtime packages are needed; fall back to copying if npm can't reach the network.
(cd "$RUNTIME" && npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null 2>&1) \
  || rsync -a --delete "$ROOT/node_modules" "$RUNTIME/"

# First install: bring over data you already created by running the app from the project folder.
if [ ! -f "$DATA/deskwork.db" ] && [ -f "$ROOT/data/deskwork.db" ]; then
  echo "Copying your existing data from $ROOT/data…"
  rsync -a --exclude 'server.*' --exclude 'launcher.log' "$ROOT/data/" "$DATA/"
fi

echo "Setting up the background server…"
mkdir -p "$(dirname "$AGENT_PLIST")"
cat >"$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE_DIR/node")</string>
    <string>--no-warnings=ExperimentalWarning</string>
    <string>server/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$RUNTIME")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATA_DIR</key><string>$(xml "$DATA")</string>
    <key>PORT</key><string>$PORT</string>
    <key>PATH</key><string>$(xml "$NODE_DIR"):/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$(xml "$DATA/server.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$DATA/server.log")</string>
</dict>
</plist>
PLIST
launchctl bootstrap "$GUI" "$AGENT_PLIST"
for _ in $(seq 1 40); do curl -fsS --max-time 1 "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.25; done

CHROME_APP="$(ls -d "$HOME/Applications/Chrome Apps.localized/Deskwork.app" "$HOME/Applications/Chrome Apps/Deskwork.app" 2>/dev/null | head -1 || true)"
if [ -n "$CHROME_APP" ]; then
  # Chrome's installed Deskwork app is the one to use; drop the launcher so Launchpad has one icon.
  for app in /Applications/Deskwork.app "$HOME/Applications/Deskwork.app"; do
    [ -d "$app" ] && { "$LSREGISTER" -u "$app" 2>/dev/null || true; rm -rf "$app"; }
  done
  echo
  echo "Updated. Open Deskwork from Launchpad (the Chrome app at $CHROME_APP)."
  exit 0
fi

echo "Creating ${APP}…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/assets/Deskwork.icns" "$APP/Contents/Resources/Deskwork.icns"
VERSION="$(node -p 'require("./package.json").version')"

cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Deskwork</string>
  <key>CFBundleDisplayName</key><string>Deskwork</string>
  <key>CFBundleIdentifier</key><string>local.deskwork.launcher</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Deskwork</string>
  <key>CFBundleIconFile</key><string>Deskwork</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- The launcher only starts the server and opens Chrome, so keep it out of the Dock. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat >"$APP/Contents/MacOS/Deskwork" <<LAUNCHER
#!/bin/bash
export DESKWORK_LAUNCHER=1
export DESKWORK_NODE_DIR=$(printf '%q' "$NODE_DIR")
export DATA_DIR=$(printf '%q' "$DATA")
export PORT=$(printf '%q' "$PORT")
exec /bin/bash $(printf '%q' "$RUNTIME/scripts/deskwork.sh") >>$(printf '%q' "$DATA/launcher.log") 2>&1
LAUNCHER
chmod +x "$APP/Contents/MacOS/Deskwork" "$RUNTIME/scripts/"*.sh

# Ad-hoc sign so macOS treats the bundle as a proper app, then tell Launchpad/Spotlight about it.
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"
"$LSREGISTER" -f "$APP" 2>/dev/null || true

echo
echo "Installed $APP"
echo "Data folder: $DATA"
echo "Open Deskwork from Launchpad or Spotlight. The first time, it asks you to make an account."
echo "Then click \"Install app\" in the top bar to give Deskwork its own Dock icon and window."
