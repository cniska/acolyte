#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Absolute path so hooks resolve correctly from any worktree
main_root=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
git config core.hooksPath "$main_root/.githooks"
