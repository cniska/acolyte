#!/usr/bin/env bash
set -euo pipefail

level="${1:-patch}"

if [[ "$level" != "patch" && "$level" != "minor" && "$level" != "major" ]]; then
  echo "Usage: $0 [patch|minor|major]" >&2
  exit 1
fi

old=$(node -p "require('./package.json').version")
npm version "$level" --no-git-tag-version >/dev/null
new=$(node -p "require('./package.json').version")

sed -i '' "s/Acolyte v${old}/Acolyte v${new}/g" src/cli-visual.int.test.ts

echo "$old → $new"

bun run verify
bun run scripts/benchmark.ts
