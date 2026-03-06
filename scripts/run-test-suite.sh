#!/usr/bin/env bash
set -euo pipefail

suite="${1:-}"

case "$suite" in
  unit)
    bun run scripts/run-unit-tests.ts
    ;;
  int)
    bun test src/*.int.test.ts src/*.int.test.tsx
    ;;
  tui)
    bun test src/*.tui.test.ts src/*.tui.test.tsx
    ;;
  perf)
    bun run scripts/run-perf.ts --runs 5 --no-warmup --fail-median-ms 3000
    ;;
  all)
    bun test
    ;;
  *)
    echo "Usage: bash scripts/run-test-suite.sh <unit|int|tui|perf|all>" >&2
    exit 1
    ;;
esac
