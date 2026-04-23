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
  echo "Missing ./acolyte (expected compiled binary). Run: bun build --compile src/cli.ts --outfile acolyte" >&2
  exit 1
fi

# Minimal, deterministic checks to ensure the compiled CLI starts.
run_quiet ./acolyte --help
run_quiet ./acolyte init --help

# Optional stronger checks (still offline/deterministic).
# This exercises tool registry wiring, the ast-grep native addon path, and the
# optional dynamic language packs (python/rust/go).
if [ "${ACOLYTE_SMOKE_EXTENDED:-}" = "1" ]; then
  tmp_dir="$(mktemp -d "./.acolyte-smoke.XXXXXX")"
  cleanup() {
    rm -rf "$tmp_dir"
  }
  trap cleanup EXIT INT TERM

  cat >"$tmp_dir/test.ts" <<'EOF'
const x = 1;
console.log(x);
EOF

  run_quiet ./acolyte tool code-scan '{"path":"src/agent-input.ts","pattern":"estimateTokens($X)","maxResults":1}'
  run_quiet ./acolyte tool code-edit '{"path":"'"$tmp_dir"'/test.ts","edits":[{"op":"rename","from":"x","to":"y"}]}'

  cat >"$tmp_dir/test.py" <<'EOF'
def main():
  x = 1
  return x
EOF

  cat >"$tmp_dir/test.rs" <<'EOF'
fn main() {
  let x = 1;
  let _ = x;
}
EOF

  cat >"$tmp_dir/test.go" <<'EOF'
package main

func main() {
  x := 1
  _ = x
}
EOF

  run_quiet ./acolyte tool code-scan '{"path":"'"$tmp_dir"'/test.py","pattern":"x = 1","language":"python","maxResults":1}'
  run_quiet ./acolyte tool code-scan '{"path":"'"$tmp_dir"'/test.rs","pattern":"let x = 1;","language":"rust","maxResults":1}'
  run_quiet ./acolyte tool code-scan '{"path":"'"$tmp_dir"'/test.go","pattern":"x := 1","language":"go","maxResults":1}'
fi
