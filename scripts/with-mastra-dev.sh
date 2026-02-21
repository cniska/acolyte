#!/usr/bin/env bash
set -euo pipefail

log_path="${ACOLYTE_MASTRA_LOG:-/tmp/acolyte-mastra-dev.log}"
bun run mastra:dev >"$log_path" 2>&1 &
mastra_pid=$!

cleanup() {
  kill "$mastra_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2
bun --env-file=.env x mastra studio
