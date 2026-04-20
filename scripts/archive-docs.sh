#!/usr/bin/env bash
# D2-2: snapshot `docs/` into `docs/v<major>.<minor>/` on a release tag
# so old README image links and tag-linked docs don't rot when the
# shipping docs on main move forward.
#
# Usage:
#   scripts/archive-docs.sh v0.2.0
#   scripts/archive-docs.sh v0.3.1    # still lands in docs/v0.3/
#
# Rules:
#   - Target directory is `docs/vMAJOR.MINOR/` — patch releases of the
#     same minor version share an archive so docs/v0.2/ is the v0.2 line,
#     not just v0.2.0.
#   - Existing `docs/vX.Y/` directories are NOT re-overwritten unless
#     --force is passed. Once the first patch of a minor line lands,
#     that archive is frozen.
#   - Nested `docs/vX.Y/` snapshots are skipped during the copy so we
#     don't recursively nest previous archives.
#   - Uses find + cp -r so it works on CI (Ubuntu), macOS, and Windows
#     Git Bash (which ships without rsync).
#   - Idempotent: running twice with no --force is a no-op.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: archive-docs.sh <tag> [--force]" >&2
  echo "  <tag> e.g. v0.2.0" >&2
  exit 2
fi

TAG="$1"
FORCE="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Slug: v0.2.0 -> v0.2, v0.3.17 -> v0.3, v1.0.0 -> v1.0.
SLUG=$(echo "$TAG" | sed -E 's/^(v[0-9]+\.[0-9]+)\..*$/\1/')
if [ -z "$SLUG" ] || ! echo "$SLUG" | grep -qE '^v[0-9]+\.[0-9]+$'; then
  echo "archive-docs: cannot derive slug from tag '$TAG' (expected vMAJOR.MINOR.PATCH)" >&2
  exit 2
fi

TARGET="docs/$SLUG"

if [ -d "$TARGET" ] && [ "$FORCE" != "--force" ]; then
  echo "archive-docs: $TARGET already exists; pass --force to overwrite" >&2
  exit 0
fi

echo "archive-docs: snapshotting docs/ -> $TARGET (tag=$TAG)"

# --force asked: wipe the target first so the copy doesn't merge stale
# files on top of the new snapshot.
if [ -d "$TARGET" ] && [ "$FORCE" = "--force" ]; then
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET"

# Find top-level entries in docs/ that aren't already a vX.Y/ archive
# and aren't the target we're about to populate. -print0 / xargs -0
# handles any path with spaces.
find docs -mindepth 1 -maxdepth 1 \
  -not -name 'v[0-9]*' \
  -not -path "$TARGET" \
  -print0 |
while IFS= read -r -d '' entry; do
  cp -r "$entry" "$TARGET/"
done

# Write a breadcrumb so a reader landing in the archive knows it's frozen.
cat > "$TARGET/ARCHIVED.md" <<EOF
# Archived docs — $SLUG line

This directory is a frozen snapshot of the \`docs/\` tree at the time
the first \`$SLUG.X\` tag was cut. It exists so tag-linked documentation
and README images stay readable after the shipping docs on \`main\`
move forward.

**First snapshot tag:** \`$TAG\`
**Snapshotted at:** $(date -u +%Y-%m-%dT%H:%M:%SZ)

For current docs see the repo's \`docs/\` directory on \`main\`.
EOF

echo "archive-docs: done -> $TARGET"
