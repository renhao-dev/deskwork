#!/bin/bash
# Prints the Homebrew formula for one release, filled in from packaging/deskwork.rb.in.
#
#   scripts/render-formula.sh <version> <archive url> <sha256>
set -euo pipefail
VERSION="${1:?version}" URL="${2:?url}" SHA="${3:?sha256}"
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "Not a SHA-256: $SHA" >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sed -e "s|@VERSION@|$VERSION|g" -e "s|@URL@|$URL|g" -e "s|@SHA256@|$SHA|g" "$ROOT/packaging/deskwork.rb.in"
