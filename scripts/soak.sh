#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${ACOLYTE_URL:-http://localhost:6767}"
MODEL="${ACOLYTE_MODEL:-openai/gpt-5-mini}"
TIMEOUT=180
PASS=0
FAIL=0

chat() {
  curl -s --max-time "$TIMEOUT" \
    -X POST "$BASE_URL/v1/chat" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"message\":\"$1\",\"history\":[]}"
}

run_test() {
  local name="$1" message="$2"
  shift 2
  local expect_tools=("$@")

  printf "  %-40s " "$name"
  local start=$SECONDS
  local raw
  raw=$(chat "$message" 2>&1)
  local duration=$(( SECONDS - start ))

  local output error tools
  output=$(echo "$raw" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('output',''))" 2>/dev/null || echo "")
  error=$(echo "$raw" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "parse_error")
  tools=$(echo "$raw" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(d.get('toolCalls',[])))" 2>/dev/null || echo "")

  local errors=""
  if [ -n "$error" ]; then
    errors="server error: $error"
  elif [ -z "$output" ]; then
    errors="empty output"
  fi

  for t in "${expect_tools[@]}"; do
    if [ -n "$t" ] && ! echo ",$tools," | grep -q ",$t,"; then
      errors="${errors:+$errors, }missing tool: $t"
    fi
  done

  if [ -z "$errors" ]; then
    echo "PASS ${duration}s [${tools}]"
    PASS=$((PASS + 1))
  else
    echo "FAIL ${duration}s ($errors)"
    FAIL=$((FAIL + 1))
  fi
}

# Check server
if ! curl -s --max-time 3 "$BASE_URL/healthz" | python3 -c "import sys,json; assert json.load(sys.stdin).get('ok')" 2>/dev/null; then
  echo "Server not running at $BASE_URL. Start with: bun run serve:env"
  exit 1
fi

echo "Soak test: $BASE_URL model=$MODEL"
echo ""

# Clean up from previous runs
rm -f /tmp/acolyte-soak-hello.ts

run_test "explore: find imports"     "find all files that import from agent-modes"          "search-files"
run_test "explore: explain function" "what does the classifyMode function do?"               "read-file"
run_test "explore: git status"       "show me the current git status"                        "git-status"
run_test "code: create file"         "create a file /tmp/acolyte-soak-hello.ts with a function hello that returns the string world" "create-file"
run_test "code: rename function"     "rename the hello function to greet in /tmp/acolyte-soak-hello.ts" ""
run_test "code: add function"        "add a function farewell that returns goodbye to /tmp/acolyte-soak-hello.ts" ""

echo ""
echo "$PASS/$((PASS + FAIL)) passed, $FAIL failed"

# Clean up
rm -f /tmp/acolyte-soak-hello.ts

[ "$FAIL" -eq 0 ]
