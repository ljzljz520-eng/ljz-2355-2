#!/usr/bin/env bash
# Rebuild packages/ui-lib as a standalone git repository with v1.0.0 and
# v2.0.0 tags, derived from the tracked snapshots under test/fixtures/.
#
# The ingestion pipeline extracts contracts from pinned git refs, so the
# sample library must be a real repository. The outer workspace tracks plain
# snapshots (no nested .git); this script materializes the tagged history.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="packages/ui-lib"
SNAP="test/fixtures"

rm -rf "$REPO"
mkdir -p "$REPO"
export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.com
export GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

git -C "$REPO" init -q
cp -r "$SNAP/v1/." "$REPO/"
git -C "$REPO" add -A
git -C "$REPO" commit -qm "ui-lib v1.0.0"
git -C "$REPO" tag v1.0.0

git -C "$REPO" rm -rq .
cp -r "$SNAP/v2/." "$REPO/"
git -C "$REPO" add -A
git -C "$REPO" commit -qm "ui-lib v2.0.0"
git -C "$REPO" tag v2.0.0

echo "bootstrapped $REPO with tags: $(git -C "$REPO" tag | tr '\n' ' ')"
