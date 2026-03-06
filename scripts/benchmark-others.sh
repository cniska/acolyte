#!/usr/bin/env bash
#
# Reproducible code quality benchmark extraction.
# Clones each repo to /tmp/acolyte-benchmarks/ and measures metrics.
#
# Usage: ./scripts/benchmark-all.sh
#
# Canonical gist: https://gist.github.com/crisu83/fb4a55d88fc0e9c9e9b5f6615d1c8673
#
set -euo pipefail

WORKDIR="/tmp/acolyte-benchmarks"
mkdir -p "$WORKDIR"

# format: name|repo_url|language
declare -a PROJECTS=(
  "aider|https://github.com/Aider-AI/aider.git|python"
  "opencode|https://github.com/anomalyco/opencode.git|typescript"
  "pi|https://github.com/badlogic/pi-mono.git|typescript"
  "goose|https://github.com/block/goose.git|rust"
  "openhands|https://github.com/All-Hands-AI/OpenHands.git|python"
  "continue|https://github.com/continuedev/continue.git|typescript"
  "cline|https://github.com/cline/cline.git|typescript"
  "openclaw|https://github.com/openclaw/openclaw.git|typescript"
)

clone_or_update() {
  local name="$1" url="$2"
  local dir="$WORKDIR/$name"
  if [ -d "$dir/.git" ]; then
    echo "  Updating $name..."
    git -C "$dir" pull --ff-only --quiet 2>/dev/null || true
  else
    echo "  Cloning $name..."
    git clone --depth 1 --quiet "$url" "$dir"
  fi
}

# --- find helpers (language-specific source/test file filters) ---

find_source_ts() {
  find "$1" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' \
    -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/generated/*' \
    -not -name '*.d.ts' \
    -not -name '*.test.ts' -not -name '*.test.tsx' \
    -not -name '*.spec.ts' -not -name '*.spec.tsx' \
    -not -name '*.int.test.ts' -not -name '*.tui.test.ts' -not -name '*.perf.test.ts'
}

find_test_ts() {
  find "$1" -type f \( \
    -name '*.test.ts' -o -name '*.test.tsx' \
    -o -name '*.spec.ts' -o -name '*.spec.tsx' \
    -o -name '*.int.test.ts' -o -name '*.tui.test.ts' -o -name '*.perf.test.ts' \
  \) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*'
}

find_source_py() {
  find "$1" -type f -name '*.py' \
    -not -path '*/.git/*' -not -path '*/__pycache__/*' \
    -not -path '*/test*/*' -not -path '*/migrations/*' -not -path '*/generated/*'
}

find_test_py() {
  find "$1" -type f -name '*.py' -path '*/test*/*' \
    -not -path '*/__pycache__/*' -not -path '*/.git/*'
}

find_source_rs() {
  find "$1" -type f -name '*.rs' \
    -not -path '*/.git/*' -not -path '*/target/*' \
    -not -path '*/tests/*' -not -name '*_test.rs'
}

find_test_rs() {
  find "$1" -type f -name '*.rs' \( -path '*/tests/*' -o -name '*_test.rs' \) \
    -not -path '*/target/*' -not -path '*/.git/*'
}

# --- counting helpers ---

count_lines() {
  # reads file list from stdin
  xargs cat 2>/dev/null | wc -l | tr -d ' '
}

count_files() {
  wc -l | tr -d ' '
}

grep_count() {
  local pattern="$1"
  { xargs grep -c "$pattern" 2>/dev/null || true; } | awk -F: '{s+=$NF} END{print s+0}'
}

per_1k() {
  local count="$1" total="$2"
  if [ "$total" -eq 0 ]; then echo "0.0"; return; fi
  awk "BEGIN{printf \"%.1f\", ($count / $total) * 1000}"
}

count_deps_ts() {
  local dir="$1"
  node -e "
    const fs = require('fs');
    const cp = require('child_process');
    const files = cp.execSync('find \"$dir\" -name package.json -not -path \"*/node_modules/*\" -not -path \"*/.git/*\"')
      .toString().trim().split('\n').filter(Boolean);
    const runtime = new Set();
    const dev = new Set();
    for (const f of files) {
      try {
        const p = JSON.parse(fs.readFileSync(f, 'utf8'));
        Object.keys(p.dependencies || {}).forEach(d => runtime.add(d));
        Object.keys(p.devDependencies || {}).forEach(d => dev.add(d));
      } catch {}
    }
    console.log(runtime.size + '|' + dev.size + '|' + (runtime.size + dev.size));
  "
}

pytoml_deps() {
  # $1 = toml file, $2 = "runtime" or "dev"
  local toml="$1" kind="$2"
  node -e 'const fs=require("fs"),t=fs.readFileSync(process.argv[1],"utf8"),k=process.argv[2];let m;if(k==="runtime"){m=t.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m)}else{m=t.match(/\[project\.optional-dependencies\]([\s\S]*?)(\n\[|$)/m)}if(!m){console.log(0)}else{console.log(Math.floor((m[1].match(/"/g)||[]).length/2))}' "$toml" "$kind"
}

count_deps_python() {
  local dir="$1"
  local runtime=0 dev=0
  if [ -f "$dir/requirements.txt" ]; then
    runtime=$({ grep -v '^#' "$dir/requirements.txt" | grep -v '^$' | grep -v '^-' | wc -l || echo 0; } | tr -d ' ')
  elif [ -f "$dir/pyproject.toml" ]; then
    runtime=$(pytoml_deps "$dir/pyproject.toml" runtime)
  fi
  for f in "$dir/requirements-dev.txt" "$dir/requirements/requirements-dev.txt"; do
    if [ -f "$f" ]; then
      dev=$({ grep -v '^#' "$f" | grep -v '^$' | grep -v '^-' | wc -l || echo 0; } | tr -d ' ')
      break
    fi
  done
  if [ "$dev" -eq 0 ] && [ -f "$dir/pyproject.toml" ]; then
    dev=$(pytoml_deps "$dir/pyproject.toml" dev)
  fi
  echo "${runtime}|${dev}|$((runtime + dev))"
}

count_deps_rust() {
  local dir="$1"
  # Use node to parse TOML-like sections for unique dep names across workspace
  node -e "
    const cp = require('child_process');
    const fs = require('fs');
    const files = cp.execSync('find \"$dir\" -name Cargo.toml -not -path \"*/target/*\"')
      .toString().trim().split('\n').filter(Boolean);
    const runtime = new Set();
    const dev = new Set();
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      let section = '';
      for (const line of text.split('\n')) {
        if (line.startsWith('[')) section = line;
        else if (section === '[dependencies]' && /^[a-z_-]/.test(line)) {
          runtime.add(line.split(/[\s=]/)[0]);
        } else if (section === '[dev-dependencies]' && /^[a-z_-]/.test(line)) {
          dev.add(line.split(/[\s=]/)[0]);
        }
      }
    }
    console.log(runtime.size + '|' + dev.size + '|' + (runtime.size + dev.size));
  "
}

# --- main ---

echo "=== Cloning / updating repos ==="
for entry in "${PROJECTS[@]}"; do
  IFS='|' read -r name url lang <<< "$entry"
  clone_or_update "$name" "$url"
done

echo ""
echo "=== Extracting metrics ==="
echo ""

for entry in "${PROJECTS[@]}"; do
  IFS='|' read -r name url lang <<< "$entry"
  dir="$WORKDIR/$name"
  echo "--- $name ($lang) ---"

  # Source and test counts
  case "$lang" in
    typescript)
      src_lines=$(find_source_ts "$dir" | count_lines)
      src_files=$(find_source_ts "$dir" | count_files)
      test_files_count=$(find_test_ts "$dir" | count_files)
      test_lines_count=$(find_test_ts "$dir" | count_lines)
      deps_raw=$(count_deps_ts "$dir")
      ;;
    python)
      src_lines=$(find_source_py "$dir" | count_lines)
      src_files=$(find_source_py "$dir" | count_files)
      test_files_count=$(find_test_py "$dir" | count_files)
      test_lines_count=$(find_test_py "$dir" | count_lines)
      deps_raw=$(count_deps_python "$dir")
      ;;
    rust)
      src_lines=$(find_source_rs "$dir" | count_lines)
      src_files=$(find_source_rs "$dir" | count_files)
      test_files_count=$(find_test_rs "$dir" | count_files)
      test_lines_count=$(find_test_rs "$dir" | count_lines)
      deps_raw=$(count_deps_rust "$dir")
      ;;
  esac

  IFS='|' read -r deps_runtime deps_dev deps_total <<< "$deps_raw"

  test_ratio="0.00"
  if [ "$src_lines" -gt 0 ]; then
    test_ratio=$(awk "BEGIN{printf \"%.2f\", $test_lines_count / $src_lines}")
  fi

  avg_lines=0
  if [ "$src_files" -gt 0 ]; then
    avg_lines=$(awk "BEGIN{printf \"%d\", $src_lines / $src_files}")
  fi

  # Module cohesion metrics
  files_over_500=0
  largest_file_lines=0
  largest_file_name=""
  barrel_files=0

  case "$lang" in
    typescript)
      find_source_ts "$dir" | while IFS= read -r f; do wc -l < "$f"; done | sort -rn > "$WORKDIR/.linecounts" 2>/dev/null || true
      barrel_files=$(find_source_ts "$dir" | { grep -c '/index\.ts$' || echo 0; } | tr -d ' ')
      ;;
    python)
      find_source_py "$dir" | while IFS= read -r f; do wc -l < "$f"; done | sort -rn > "$WORKDIR/.linecounts" 2>/dev/null || true
      barrel_files=$(find_source_py "$dir" | { grep -c '/__init__\.py$' || echo 0; } | tr -d ' ')
      ;;
    rust)
      find_source_rs "$dir" | while IFS= read -r f; do wc -l < "$f"; done | sort -rn > "$WORKDIR/.linecounts" 2>/dev/null || true
      barrel_files=$(find_source_rs "$dir" | { grep -c '/mod\.rs$' || echo 0; } | tr -d ' ')
      ;;
  esac

  if [ -s "$WORKDIR/.linecounts" ]; then
    largest_file_lines=$(head -1 "$WORKDIR/.linecounts" | tr -d ' ')
    files_over_500=$(awk '$1 > 500' "$WORKDIR/.linecounts" | wc -l | tr -d ' ')
  fi

  files_over_500_pct=0
  if [ "$src_files" -gt 0 ]; then
    files_over_500_pct=$(awk "BEGIN{printf \"%d\", ($files_over_500 / $src_files) * 100}")
  fi

  echo "  Source lines:     $src_lines"
  echo "  Source files:     $src_files"
  echo "  Avg lines/file:   $avg_lines"
  echo "  Files > 500:      $files_over_500 ($files_over_500_pct%)"
  echo "  Largest file:     $largest_file_lines"
  echo "  Barrel files:     $barrel_files"
  echo "  Dependencies:     $deps_runtime runtime + $deps_dev dev = $deps_total total"
  echo "  Test files:       $test_files_count"
  echo "  Test lines:       $test_lines_count"
  echo "  Test/source:      $test_ratio"

  # Language-specific quality metrics
  if [ "$lang" = "typescript" ]; then
    as_any=$(find_source_ts "$dir" | grep_count "as any")
    colon_any=$(find_source_ts "$dir" | grep_count ": any")
    ts_ignore=$(find_source_ts "$dir" | grep_count "@ts-ignore\|@ts-expect-error")
    lint_ignore=$(find_source_ts "$dir" | grep_count "eslint-disable\|biome-ignore")
    unknown=$(find_source_ts "$dir" | grep_count ": unknown")
    todo=$(find_source_ts "$dir" | grep_count "TODO\|FIXME\|HACK")
    comments=$(find_source_ts "$dir" | grep_count '^\s*//')
    safe_parse=$(find_source_ts "$dir" | grep_count '\.safeParse(')
    try_blocks=$(find_source_ts "$dir" | grep_count 'try {')
    catch_calls=$(find_source_ts "$dir" | grep_count '\.catch(')

    echo "  as any /1k:       $(per_1k "$as_any" "$src_lines")  ($as_any total)"
    echo "  : any /1k:        $(per_1k "$colon_any" "$src_lines")  ($colon_any total)"
    echo "  @ts-ignore /1k:   $(per_1k "$ts_ignore" "$src_lines")  ($ts_ignore total)"
    echo "  lint ignores /1k: $(per_1k "$lint_ignore" "$src_lines")  ($lint_ignore total)"
    echo "  : unknown /1k:    $(per_1k "$unknown" "$src_lines")  ($unknown total)"
    echo "  TODO|FIXME /1k:   $(per_1k "$todo" "$src_lines")  ($todo total)"
    echo "  Comments /1k:     $(per_1k "$comments" "$src_lines")  ($comments total)"
    echo "  .safeParse /1k:   $(per_1k "$safe_parse" "$src_lines")  ($safe_parse total)"
    echo "  try {} /1k:       $(per_1k "$try_blocks" "$src_lines")  ($try_blocks total)"
    echo "  .catch() /1k:     $(per_1k "$catch_calls" "$src_lines")  ($catch_calls total)"
  elif [ "$lang" = "python" ]; then
    type_ignore=$(find_source_py "$dir" | grep_count "type: ignore")
    any_type=$(find_source_py "$dir" | grep_count "Any")
    cast_calls=$(find_source_py "$dir" | grep_count "cast(")
    todo=$(find_source_py "$dir" | grep_count "TODO\|FIXME\|HACK")
    comments=$(find_source_py "$dir" | grep_count '^\s*#')

    echo "  type: ignore /1k: $(per_1k "$type_ignore" "$src_lines")  ($type_ignore total)"
    echo "  Any type /1k:     $(per_1k "$any_type" "$src_lines")  ($any_type total)"
    echo "  cast() /1k:       $(per_1k "$cast_calls" "$src_lines")  ($cast_calls total)"
    echo "  TODO|FIXME /1k:   $(per_1k "$todo" "$src_lines")  ($todo total)"
    echo "  Comments /1k:     $(per_1k "$comments" "$src_lines")  ($comments total)"
  elif [ "$lang" = "rust" ]; then
    unsafe=$(find_source_rs "$dir" | grep_count "unsafe")
    unwrap=$(find_source_rs "$dir" | grep_count '\.unwrap()')
    expect_calls=$(find_source_rs "$dir" | grep_count '\.expect(')
    todo=$(find_source_rs "$dir" | grep_count "TODO\|FIXME\|HACK")
    comments=$(find_source_rs "$dir" | grep_count '^\s*//')

    echo "  unsafe /1k:       $(per_1k "$unsafe" "$src_lines")  ($unsafe total)"
    echo "  .unwrap() /1k:    $(per_1k "$unwrap" "$src_lines")  ($unwrap total)"
    echo "  .expect() /1k:    $(per_1k "$expect_calls" "$src_lines")  ($expect_calls total)"
    echo "  TODO|FIXME /1k:   $(per_1k "$todo" "$src_lines")  ($todo total)"
    echo "  Comments /1k:     $(per_1k "$comments" "$src_lines")  ($comments total)"
  fi

  echo ""
done

echo "Done. All repos at $WORKDIR"
