#!/usr/bin/env bash
# Bootstrap a fresh Acolyte worktree so an agent (or you) can build and run
# immediately instead of hitting a missing-node_modules or missing-.env wall.
# Invoked by `wt` on worktree creation; safe to run by hand from any worktree.
# Idempotent. Steps are independent — one failing does not block the others.
set -uo pipefail

# Worktree root is this script's parent dir's parent (scripts/..).
root=$(cd "$(dirname "$0")/.." && pwd)

step() { printf '\n── %s\n' "$*"; }
rc=0

step "install — bun install"
if ! ( cd "$root" && bun install --frozen-lockfile ); then
  echo "worktree-setup: bun install failed" >&2
  rc=1
fi

# .env is gitignored, so a fresh worktree has none — link the primary checkout's so
# serve/dogfood work without copying secrets around. Non-fatal if the primary has none.
step "env — link .env from the primary checkout"
primary=$(cd "$root" && git worktree list --porcelain | sed -n '1s/^worktree //p')
if [ -n "${primary:-}" ] && [ "$primary" != "$root" ] && [ -f "$primary/.env" ] && [ ! -e "$root/.env" ]; then
  ln -s "$primary/.env" "$root/.env" && echo "linked .env -> $primary/.env"
elif [ -e "$root/.env" ]; then
  echo ".env already present"
else
  echo "no primary .env to link (skipping)"
fi

# docs/notes/ holds gitignored private notes (plan, design records) — link the
# primary's so a worktree sees the same notes instead of an empty folder.
step "docs/notes — link from the primary checkout"
if [ -n "${primary:-}" ] && [ "$primary" != "$root" ] && [ -d "$primary/docs/notes" ] && [ ! -e "$root/docs/notes" ]; then
  ln -s "$primary/docs/notes" "$root/docs/notes" && echo "linked docs/notes -> $primary/docs/notes"
elif [ -e "$root/docs/notes" ]; then
  echo "docs/notes already present"
else
  echo "no primary docs/notes to link (skipping)"
fi

if [ "$rc" -eq 0 ]; then
  echo "worktree-setup: done"
else
  echo "worktree-setup: finished with errors" >&2
fi
exit "$rc"
