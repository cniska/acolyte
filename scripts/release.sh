#!/usr/bin/env bash
set -euo pipefail

# Safety checks
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "error: must be on main branch" >&2; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working directory not clean" >&2; exit 1
fi

level="${1:-patch}"
if [[ "$level" != "patch" && "$level" != "minor" && "$level" != "major" ]]; then
  echo "Usage: $0 [patch|minor|major]" >&2; exit 1
fi

old=$(node -p "require('./package.json').version")
npm version "$level" --no-git-tag-version >/dev/null
new=$(node -p "require('./package.json').version")

# Update test snapshot
sed -i '' "s/Acolyte v${old}/Acolyte v${new}/g" src/cli-visual.int.test.ts

echo "$old → $new"

# Verify everything passes with new version
bun run verify
bun run scripts/benchmark.ts

# Commit and tag
git add -A
git commit -m "chore: release v${new}"
git tag "v${new}"

echo ""
echo "Ready to push v${new}. Run:"
echo "  git push && git push origin v${new}"
