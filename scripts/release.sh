#!/usr/bin/env bash
set -euo pipefail

# Safety checks
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "error: must be on main branch" >&2; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working directory not clean" >&2; exit 1
fi

level="${1:-}"
if [[ -z "$level" || ("$level" != "patch" && "$level" != "minor" && "$level" != "major") ]]; then
  echo "Usage: $0 <patch|minor|major>" >&2; exit 1
fi

old=$(node -p "require('./package.json').version")
npm version "$level" --no-git-tag-version >/dev/null
new=$(node -p "require('./package.json').version")

# Update test snapshot
sed -i '' "s/Acolyte v${old}/Acolyte v${new}/g" src/cli-visual.int.test.ts

# Generate changelog entry
prev_tag="v${old}"
date=$(date +%Y-%m-%d)
entry="## ${new} (${date})"$'\n\n'

scope_re='^[a-z]+\(([^)]+)\):'

while IFS= read -r line; do
  hash="${line%% *}"
  msg="${line#* }"
  # Strip conventional commit prefix for cleaner bullets
  clean="${msg#*: }"
  scope=""
  if [[ "$msg" =~ $scope_re ]]; then
    scope="**${BASH_REMATCH[1]}:** "
  fi
  entry+="- ${scope}${clean} (\`${hash:0:8}\`)"$'\n'
done < <(git log "${prev_tag}..HEAD" --oneline --no-merges --reverse)

if [[ -f CHANGELOG.md ]]; then
  # Prepend new entry after the heading line
  { head -1 CHANGELOG.md; echo ""; echo "$entry"; tail -n +2 CHANGELOG.md; } > CHANGELOG.tmp
  mv CHANGELOG.tmp CHANGELOG.md
else
  echo "# Changelog" > CHANGELOG.md
  echo "" >> CHANGELOG.md
  echo "$entry" >> CHANGELOG.md
fi

echo "$old → $new"

# Verify everything passes with new version
bun run verify

# Commit and tag
git add -A
git commit -m "chore: release v${new}"
git tag "v${new}"

echo ""
echo "Ready to push v${new}. Run:"
echo "  git push && git push origin v${new}"
