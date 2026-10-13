#!/bin/bash
# Puts Deskwork in Launchpad for a Homebrew install: makes "Deskwork(chrome tab).app" in ~/Applications, a small app
# that starts the server if it isn't running and opens Deskwork in Chrome. The server runs this each
# time it starts, so the icon appears on its own and comes back if it is deleted.
#
# Once Deskwork is installed as a Chrome app ("Install app" in the top bar), that app is the one to
# use: the launcher opens it and removes itself, and isn't made again while the Chrome app exists.
#
#   DESKWORK_BREW   path to brew, so the launcher can start the service
#   PORT            port the server is on (default 5174)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5174}"
BREW="${DESKWORK_BREW:-brew}"
# Named apart from Chrome's own "Deskwork" app, so Launchpad never shows two icons that look the same.
NAME="Deskwork(chrome tab)"
APP="$HOME/Applications/$NAME.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# Version 0.1.1 called the launcher plain "Deskwork". Remove that one, but only if it really is ours.
OLD="$HOME/Applications/Deskwork.app"
if [ "$(defaults read "$OLD/Contents/Info" CFBundleIdentifier 2>/dev/null || true)" = local.deskwork.launcher ]; then
  "$LSREGISTER" -u "$OLD" 2>/dev/null || true
  rm -rf "$OLD"
fi
VERSION="$(sed -nE 's/^ *"version": *"([^"]+)".*/\1/p' "$HERE/package.json" | head -1)"

chrome_app() { ls -d "$HOME/Applications/Chrome Apps.localized/Deskwork.app" "$HOME/Applications/Chrome Apps/Deskwork.app" 2>/dev/null | head -1 || true; }

# Chrome's own Deskwork app already gives a Launchpad icon; a second one would only confuse.
[ -z "$(chrome_app)" ] || exit 0
# Already there and from this version: nothing to do.
[ "$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)" != "$VERSION" ] || exit 0

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$HERE/assets/Deskwork.icns" "$APP/Contents/Resources/Deskwork.icns"

cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
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

# What runs when the icon is clicked. Paths are written in now; \$ is left for the launcher itself.
cat >"$APP/Contents/MacOS/Deskwork" <<LAUNCHER
#!/bin/bash
URL="http://localhost:$PORT"
BREW=$(printf '%q' "$BREW")
APP=$(printf '%q' "$APP")
healthy() { curl -fsS --max-time 1 "\$URL/api/health" >/dev/null 2>&1; }

if ! healthy; then
  # Stopped, or never started since login: ask the background service to run.
  launchctl kickstart "gui/\$(id -u)/homebrew.mxcl.deskwork" >/dev/null 2>&1 || "\$BREW" services start deskwork >/dev/null 2>&1 || true
  for _ in \$(seq 1 60); do healthy && break; sleep 0.25; done
fi
if ! healthy; then
  osascript -e 'display alert "Deskwork can’t start" message "Its server isn’t running. Open Terminal and run: brew services start deskwork" as critical' >/dev/null 2>&1
  exit 1
fi

# Prefer Deskwork installed as a Chrome app: its own window, Dock icon and Cmd+Tab entry.
CHROME_APP="\$(ls -d "\$HOME/Applications/Chrome Apps.localized/Deskwork.app" "\$HOME/Applications/Chrome Apps/Deskwork.app" 2>/dev/null | head -1)"
if [ -n "\$CHROME_APP" ]; then
  open "\$CHROME_APP"
  # This launcher is no longer needed; remove it so Launchpad shows a single Deskwork icon.
  $LSREGISTER -u "\$APP" 2>/dev/null
  rm -rf "\$APP"
  exit 0
fi

CHROME="/Applications/Google Chrome.app"
[ -d "\$CHROME" ] || CHROME="\$HOME/Applications/Google Chrome.app"
if [ -d "\$CHROME" ]; then
  # A normal window, not a chromeless --app one: Chrome only offers "Install app" in normal windows.
  open -na "\$CHROME" --args --new-window "\$URL"
else
  open "\$URL" # no Chrome: use the default browser
fi
LAUNCHER
chmod +x "$APP/Contents/MacOS/Deskwork"

# Ad-hoc sign so macOS treats the bundle as a proper app, then tell Launchpad/Spotlight about it.
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"
"$LSREGISTER" -f "$APP" 2>/dev/null || true
echo "Deskwork is in Launchpad: $APP"
