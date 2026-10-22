#!/usr/bin/env bash
# The only force-pushed history is the generated data branch. Serialise writers
# in Actions; every changed snapshot has a new root commit and no parent history.
set -euo pipefail
cd public/data
git init -b data
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add --all .
tree=$(git write-tree)
if [ "$tree" = "${PREVIOUS_TREE:-}" ]; then
  echo 'Data snapshot unchanged'
  echo 'changed=false' >> "$GITHUB_OUTPUT"
else
  git -c commit.gpgsign=false commit --allow-empty -m 'Current optional weather data snapshot'
  # gh reads the built-in token from GH_TOKEN; no credentials enter the snapshot.
  git -c credential.helper='!gh auth git-credential' push --force "${DATA_BRANCH_REMOTE:-https://github.com/${GITHUB_REPOSITORY}.git}" HEAD:refs/heads/data
  echo 'changed=true' >> "$GITHUB_OUTPUT"
fi
