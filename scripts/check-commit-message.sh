#!/usr/bin/env bash
set -euo pipefail

# Validate a commit message against project conventions.
# Usage: check-commit-message.sh <subject> [body]
#
# Rules:
#   - Conventional Commit format: type(scope): description
#   - Allowed types: feat, fix, refactor, docs, test, chore
#   - Single-line subject, no body
#   - Under 72 characters
#   - ASCII only

subject="${1:-}"
body="${2:-}"

if [ -z "$subject" ]; then
  echo "usage: check-commit-message.sh <subject> [body]" >&2
  exit 2
fi

cc_re='^(feat|fix|refactor|docs|test|chore)(\([a-z0-9-]+\))?!?: .+'

if [ -n "$body" ]; then
  echo "error: commit has a body. Commits must be single-line subject only." >&2
  exit 1
fi

if ! [[ "$subject" =~ $cc_re ]]; then
  echo "error: subject does not match Conventional Commit format." >&2
  echo "  expected: type(scope): description" >&2
  echo "  got:      $subject" >&2
  exit 1
fi

if [ "${#subject}" -gt 72 ]; then
  echo "error: subject exceeds 72 characters (${#subject})." >&2
  exit 1
fi

non_ascii=$(echo "$subject" | LC_ALL=C tr -d ' -~')
if [ -n "$non_ascii" ]; then
  echo "error: subject contains non-ASCII characters." >&2
  exit 1
fi
