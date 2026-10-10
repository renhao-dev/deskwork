#!/bin/bash
# Releases Deskwork: asks for the new version, tags the current commit, and pushes the tag. The push
# starts .github/workflows/release.yml, which tests, publishes and updates the Homebrew formula.
#
#   scripts/release.sh            ask, tag, push, then follow the release run
#   scripts/release.sh --dry-run  everything up to tagging, without changing anything
set -euo pipefail

DRY_RUN=false
[ "${1:-}" = --dry-run ] && DRY_RUN=true

cd "$(dirname "${BASH_SOURCE[0]}")/.."
fail() { echo "✗ $1" >&2; exit 1; }
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

# ---------- is this commit ready to release? ----------

[ "$(git branch --show-current)" = main ] || fail "Release from main. You're on $(git branch --show-current || echo 'no branch')."
[ -z "$(git status --porcelain)" ] || fail "There are uncommitted changes. Commit or stash them first: a tag only covers committed work."

git fetch --quiet --tags origin main
# The workflow builds the tagged commit on GitHub, so GitHub must already have it.
git merge-base --is-ancestor HEAD origin/main || fail "This commit isn't on GitHub yet. Run: git push"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || fail "GitHub's main has commits you don't have. Run: git pull"

# ---------- what's new since the last release ----------

LAST=$(git tag --list 'v*.*.*' | sed 's/^v//' | grep -E "$SEMVER" | sort -V | tail -1 || true)
if [ -n "$LAST" ]; then
  CHANGES=$(git log --oneline "v$LAST..HEAD")
  [ -n "$CHANGES" ] || fail "Nothing has changed since v$LAST."
  echo "Last release: v$LAST"
  echo
  echo "Commits since then:"
  echo "$CHANGES" | sed 's/^/  /'
  IFS=. read -r MAJOR MINOR PATCH <<< "$LAST"
  PATCH_V="$MAJOR.$MINOR.$((PATCH + 1))"
  MINOR_V="$MAJOR.$((MINOR + 1)).0"
  MAJOR_V="$((MAJOR + 1)).0.0"
else
  echo "No releases yet."
  PATCH_V=0.1.0 MINOR_V=0.1.0 MAJOR_V=1.0.0
fi

# ---------- the new version ----------

echo
echo "New version:"
echo "  1) $PATCH_V  fixes only"
[ "$MINOR_V" != "$PATCH_V" ] && echo "  2) $MINOR_V  new features"
echo "  3) $MAJOR_V  big or breaking changes"
echo "  or type a version, like 0.4.2"
read -r -p "Choice [1]: " ANSWER
case "${ANSWER:-1}" in
  1) VERSION=$PATCH_V ;;
  2) VERSION=$MINOR_V ;;
  3) VERSION=$MAJOR_V ;;
  *) VERSION=${ANSWER#v} ;;
esac

[[ "$VERSION" =~ $SEMVER ]] || fail "“$VERSION” isn't a version. Use three numbers, like 0.4.2."
if [ -n "$LAST" ]; then
  HIGHER=$(printf '%s\n%s\n' "$LAST" "$VERSION" | sort -V | tail -1)
  if [ "$VERSION" = "$LAST" ] || [ "$HIGHER" != "$VERSION" ]; then
    fail "$VERSION isn't higher than v$LAST. Homebrew only upgrades to higher versions."
  fi
fi
TAG="v$VERSION"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && fail "$TAG already exists."
[ -z "$(git ls-remote --tags origin "refs/tags/$TAG")" ] || fail "$TAG already exists on GitHub."

echo
echo "Release $TAG from $(git log --oneline -1 HEAD)"
read -r -p "Tag and push it? [y/N] " OK
[[ "$OK" =~ ^[Yy]$ ]] || fail "Stopped. Nothing was changed."

if $DRY_RUN; then
  echo "Dry run: would run  git tag -a $TAG -m 'Deskwork $VERSION' && git push origin $TAG"
  exit 0
fi

# ---------- tag, push, follow ----------

git tag -a "$TAG" -m "Deskwork $VERSION"
if ! git push --quiet origin "$TAG"; then
  git tag -d "$TAG" >/dev/null
  fail "Pushing the tag failed, so the local tag was removed again. Nothing was released."
fi
echo "✓ Pushed $TAG. The release workflow is starting."

if ! command -v gh >/dev/null; then
  echo "Follow it at: https://github.com/renhao-dev/deskwork/actions"
  exit 0
fi

# GitHub takes a few seconds to start the run; wait for the one belonging to this tag.
RUN=""
for _ in $(seq 30); do
  RUN=$(gh run list --workflow release.yml --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
  [ -n "$RUN" ] && break
  sleep 2
done
[ -n "$RUN" ] || { echo "The run hasn't appeared yet. Follow it at: https://github.com/renhao-dev/deskwork/actions"; exit 0; }

if gh run watch "$RUN" --exit-status --interval 10; then
  echo
  echo "✓ Deskwork $VERSION is released. Users get it with: brew upgrade deskwork"
else
  echo
  echo "✗ The release failed. Nothing was published unless the publish job ran. See what went wrong:"
  echo "  gh run view $RUN --log-failed"
  exit 1
fi
