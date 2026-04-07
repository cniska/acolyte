#!/usr/bin/env sh
set -eu

if [ ! -x "./acolyte" ]; then
  echo "Missing ./acolyte (expected compiled binary). Run: bun build --compile src/cli.ts --outfile acolyte" >&2
  exit 1
fi

# Minimal, deterministic checks to ensure the compiled CLI starts.
./acolyte --help >/dev/null
./acolyte init --help >/dev/null

# Optional stronger checks (still offline/deterministic).
# This exercises tool registry wiring, the ast-grep native addon path, and the
# dynamic language packs (python/rust/go).
if [ "${ACOLYTE_SMOKE_EXTENDED:-}" = "1" ]; then
  tmp_dir="$(mktemp -d "./.acolyte-smoke.XXXXXX")"
  cleanup() {
    rm -rf "$tmp_dir"
  }
  trap cleanup EXIT INT TERM

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

  ./acolyte tool code-edit '{"path":"'"$tmp_dir"'/test.py","edits":[{"op":"rename","from":"x","to":"y"}]}' >/dev/null
  ./acolyte tool code-edit '{"path":"'"$tmp_dir"'/test.rs","edits":[{"op":"rename","from":"x","to":"y"}]}' >/dev/null
  ./acolyte tool code-edit '{"path":"'"$tmp_dir"'/test.go","edits":[{"op":"rename","from":"x","to":"y"}]}' >/dev/null
fi
