#!/usr/bin/env sh
set -eu

run_quiet() {
  out="$(mktemp)"
  if "$@" >"$out" 2>&1; then
    rm -f "$out"
    return 0
  fi
  cat "$out" >&2
  rm -f "$out"
  return 1
}

if [ ! -x "./acolyte" ]; then
  echo "Missing ./acolyte (expected compiled binary). Run: bash scripts/build-compiled.sh" >&2
  exit 1
fi

# Minimal, deterministic checks to ensure the compiled CLI starts.
run_quiet ./acolyte --help
run_quiet ./acolyte auth --help

# The compiled binary must report its baked version, not "dev" or the version
# of whatever project it happens to run inside.
expected="$(bun -e 'console.log(require("./package.json").version)')"
reported="$(./acolyte --version)"
case "$reported" in
  "$expected" | "$expected "*) ;;
  *)
    echo "Version mismatch: expected '$expected', got '$reported'" >&2
    exit 1
    ;;
esac

# Optional stronger checks (still offline/deterministic).
# This exercises tool registry wiring, the ast-grep native addon path, and the daemon the binary
# has to spawn for itself.
if [ "${ACOLYTE_SMOKE_EXTENDED:-}" = "1" ]; then
  # Absolute, and inside the repo so the workspace-scoped tool checks below still accept it. The
  # config and state directories are read only from absolute values, so a relative temp dir would
  # send this run at the developer's own config and daemon.
  tmp_dir="$(mktemp -d "$(pwd)/.acolyte-smoke.XXXXXX")"
  smoke_home="$tmp_dir/home"
  daemon_started=""

  # Every credential and state directory points inside the temp tree, so the run behaves like a host
  # that has never seen Acolyte and leaves nothing of its own behind.
  acolyte_fresh_host() {
    NO_COLOR=1 \
      HOME="$smoke_home" \
      XDG_CONFIG_HOME="$smoke_home/config" \
      XDG_DATA_HOME="$smoke_home/data" \
      XDG_STATE_HOME="$smoke_home/state" \
      ACOLYTE_PROJECT_DIR="$tmp_dir" \
      ./acolyte "$@"
  }

  cleanup() {
    if [ -n "$daemon_started" ]; then
      acolyte_fresh_host stop >/dev/null 2>&1 || true
    fi
    rm -rf "$tmp_dir"
  }
  trap cleanup EXIT INT TERM

  cat >"$tmp_dir/test.ts" <<'EOF'
const x = 1;
console.log(x);
EOF

  run_quiet ./acolyte tool code-scan '{"path":"src/agent-input.ts","pattern":"estimateTokens($X)","maxResults":1}'
  run_quiet ./acolyte tool code-edit '{"path":"'"$tmp_dir"'/test.ts","edits":[{"op":"rename","from":"x","to":"y"}]}'

  # A standalone build carries no `server.ts` a runtime could execute, so reaching the server means
  # re-running the binary. Nothing above this line needs a daemon, so nothing above it catches a
  # binary that cannot start one -- and without a daemon there is no chat, no run, and no skill.
  mkdir -p "$smoke_home/config/acolyte"
  echo 'port = 6799' >"$smoke_home/config/acolyte/config.toml"

  if ! run_quiet acolyte_fresh_host start; then
    echo "Compiled binary could not start its server daemon" >&2
    exit 1
  fi
  daemon_started=1

  # The port comes from the temp tree's own config, so seeing it here is what proves this run reads
  # that config rather than the developer's -- and reaches its own daemon rather than a live one.
  if ! acolyte_fresh_host ps 2>/dev/null | grep -q 6799; then
    echo "Smoke daemon did not take the isolated port 6799" >&2
    exit 1
  fi

  if ! run_quiet acolyte_fresh_host status; then
    echo "Compiled binary started a daemon it could not talk to" >&2
    exit 1
  fi

  if ! run_quiet acolyte_fresh_host stop; then
    echo "Compiled binary could not stop its server daemon" >&2
    exit 1
  fi
  daemon_started=""
fi
