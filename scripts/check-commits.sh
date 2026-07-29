#!/usr/bin/env bash
set -euo pipefail

# Validate every commit in a revision range against project conventions.
# Usage: check-commits.sh <rev-list-args...>
#
# Shared by the pre-push hook and CI so both enforce the same rules. Reports every
# offending commit rather than stopping at the first.

root=$(git rev-parse --show-toplevel)

if ! commits=$(git rev-list "$@"); then
  echo "error: cannot enumerate commits for: $*" >&2
  exit 1
fi

if [ -z "$commits" ]; then
  exit 0
fi

status=0
while IFS= read -r oid; do
  subject=$(git log -1 --format='%s' "$oid")
  body=$(git log -1 --format='%b' "$oid")
  author_name=$(git log -1 --format='%an' "$oid")
  author_email=$(git log -1 --format='%ae' "$oid")
  committer_name=$(git log -1 --format='%cn' "$oid")
  committer_email=$(git log -1 --format='%ce' "$oid")

  offending=0
  bash "$root/scripts/check-commit-message.sh" "$subject" "$body" || offending=1
  bash "$root/scripts/check-commit-author.sh" "$author_name" "$author_email" author || offending=1
  bash "$root/scripts/check-commit-author.sh" "$committer_name" "$committer_email" committer || offending=1
  if [ "$offending" -eq 1 ]; then
    echo "  commit: $oid" >&2
    status=1
  fi
done <<< "$commits"

exit "$status"
