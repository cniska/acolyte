#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <serve-script> <command...>" >&2
  exit 1
fi

serve_script="$1"
shift

log_path="${ACOLYTE_SERVER_LOG:-/tmp/acolyte-server.log}"
wait_url="${ACOLYTE_SERVER_WAIT_URL:-http://localhost:6767/v1/status}"
wait_timeout_ms="${ACOLYTE_SERVER_WAIT_TIMEOUT_MS:-10000}"
api_url="${ACOLYTE_API_URL:-http://localhost:6767}"

server_pid=""
started_server=0

wait_for_server() {
  bun run wait:server --url "$wait_url" --timeout-ms "$wait_timeout_ms" >/dev/null
}

if ! bun run wait:server --url "$wait_url" --timeout-ms "300" >/dev/null 2>&1; then
  bun run "$serve_script" >"$log_path" 2>&1 &
  server_pid=$!
  started_server=1

  if ! wait_for_server; then
    echo "Failed to start server; tailing ${log_path}:" >&2
    tail -n 80 "$log_path" >&2 || true
    exit 1
  fi
fi

cleanup() {
  if [[ "$started_server" == "1" && -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ "${ACOLYTE_SET_API_URL:-0}" == "1" ]]; then
  bun run src/cli.ts config set apiUrl "$api_url" >/dev/null
fi

"$@"
