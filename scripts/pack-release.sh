#!/bin/bash
# Packs a built Deskwork into deskwork-<version>.tar.gz: what the server needs to run, nothing else.
# Run `npm run build` first. The Homebrew formula installs the server's packages from the lock file.
#
#   scripts/pack-release.sh 0.2.0 [out-dir]
set -euo pipefail

VERSION="${1:?Usage: pack-release.sh <version> [out-dir]}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(mkdir -p "${2:-$ROOT}" && cd "${2:-$ROOT}" && pwd)"
NAME="deskwork-$VERSION"

[ -f "$ROOT/web/dist/index.html" ] || { echo "No web/dist. Run npm run build first." >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$NAME/web"
cp -R "$ROOT/server" "$ROOT/shared" "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/$NAME/"
cp -R "$ROOT/web/dist" "$STAGE/$NAME/web/"
# The Launchpad icon: the script that makes Deskwork.app, and the icon it uses.
mkdir -p "$STAGE/$NAME/packaging" "$STAGE/$NAME/assets"
cp "$ROOT/packaging/mac-launcher.sh" "$STAGE/$NAME/packaging/"
cp "$ROOT/assets/Deskwork.icns" "$STAGE/$NAME/assets/"
# The version comes from the release tag, so package.json in the repo never has to be bumped by hand.
(cd "$STAGE/$NAME" && npm pkg set version="$VERSION")

# Fixed owner and no macOS extras, so the archive is the same wherever it is made.
COPYFILE_DISABLE=1 tar -czf "$OUT/$NAME.tar.gz" -C "$STAGE" --exclude .DS_Store "$NAME"
(cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
echo "$OUT/$NAME.tar.gz"
