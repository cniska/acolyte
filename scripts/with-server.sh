#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <serve-script> <command...>" >&2
  exit 1
fi

serve_script="$1"
shift

log_path="${ACOLYTE_SERVER_LOG:-$HOME/.acolyte/server.log}"
wait_url="${ACOLYTE_SERVER_WAIT_URL:-http://localhost:6767/v1/status}"
wait_timeout_ms="${ACOLYTE_SERVER_WAIT_TIMEOUT_MS:-10000}"
restart_server="${ACOLYTE_SERVER_RESTART:-0}"

server_pid=""
started_server=0

wait_for_server() {
  bun run wait:server --url "$wait_url" --timeout-ms "$wait_timeout_ms" >/dev/null
}

if [[ "$restart_server" == "1" ]]; then
  bun run src/cli.ts server stop >/dev/null 2>&1 || true
  if bun run wait:server --url "$wait_url" --timeout-ms "300" >/dev/null 2>&1; then
    echo "Server still running at ${wait_url} after requested restart." >&2
    echo "Stop external server manually, then retry." >&2
    exit 1
  fi
fi

if ! bun run wait:server --url "$wait_url" --timeout-ms "300" >/dev/null 2>&1; then
  mkdir -p "$(dirname "$log_path")"
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

"$@"
