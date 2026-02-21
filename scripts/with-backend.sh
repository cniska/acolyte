#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <serve-script> <command...>" >&2
  exit 1
fi

serve_script="$1"
shift

log_path="${ACOLYTE_BACKEND_LOG:-/tmp/acolyte-server.log}"
wait_url="${ACOLYTE_BACKEND_WAIT_URL:-http://localhost:6767/healthz}"
wait_timeout_ms="${ACOLYTE_BACKEND_WAIT_TIMEOUT_MS:-10000}"
api_url="${ACOLYTE_BACKEND_API_URL:-http://localhost:6767}"

bun run "$serve_script" >"$log_path" 2>&1 &
backend_pid=$!

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bun run wait:backend --url "$wait_url" --timeout-ms "$wait_timeout_ms" >/dev/null

if [[ "${ACOLYTE_SET_API_URL:-0}" == "1" ]]; then
  bun run config set apiUrl "$api_url" >/dev/null
fi

"$@"
