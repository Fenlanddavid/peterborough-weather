#!/usr/bin/env bash
# Restore a complete snapshot before touching the destination. A missing branch is
# the only permissible fallback; authentication, transport and archive errors fail.
set -euo pipefail
case "${1:-}" in
  public/data|dist/data) destination=$1 ;;
  *) echo 'Expected public/data or dist/data' >&2; exit 1 ;;
esac
snapshot_ref=${DATA_BRANCH_REMOTE:-origin}
previous_tree=''
if git ls-remote --exit-code --heads "$snapshot_ref" data > /dev/null; then
  git fetch --no-tags --depth=1 "$snapshot_ref" refs/heads/data
  previous_tree=$(git rev-parse 'FETCH_HEAD^{tree}')
  snapshot_dir=$(mktemp -d)
  trap 'rm -rf "$snapshot_dir"' EXIT
  git archive FETCH_HEAD | tar -x -C "$snapshot_dir"
  # Extraction succeeded. Replace rather than overlay so removed files stay removed.
  rm -rf "$destination"
  mkdir -p "$destination"
  cp -a "$snapshot_dir/." "$destination/"
else
  status=$?
  if [ "$status" -ne 2 ]; then
    echo "Cannot read data branch (git ls-remote exit $status); existing files retained" >&2
    exit "$status"
  fi
  echo 'No data branch yet; using main public/data'
  if [ "$destination" = dist/data ]; then
    # Vite copies main public/data during the initial migration build.
    test -d public/data
    rm -rf dist/data
    mkdir -p dist/data
    cp -a public/data/. dist/data/
  else
    test -d public/data
  fi
fi
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "PREVIOUS_TREE=$previous_tree" >> "$GITHUB_ENV"
fi
