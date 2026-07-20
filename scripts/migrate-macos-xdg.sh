#!/usr/bin/env bash
set -euo pipefail

home="${HOME:?HOME is required}"
legacy_dir="${ACOLYTE_LEGACY_DIR:-$home/.acolyte}"
if [[ "${XDG_CONFIG_HOME:-}" = /* ]]; then
  config_home="$XDG_CONFIG_HOME"
else
  config_home="$home/.config"
fi
if [[ "${XDG_DATA_HOME:-}" = /* ]]; then
  data_home="$XDG_DATA_HOME"
else
  data_home="$home/.local/share"
fi
if [[ "${XDG_STATE_HOME:-}" = /* ]]; then
  state_home="$XDG_STATE_HOME"
else
  state_home="$home/.local/state"
fi

config_dir="$config_home/acolyte"
data_dir="$data_home/acolyte"
state_dir="$state_home/acolyte"
bin_dir="$home/.local/bin"

if [[ ! -d "$legacy_dir" ]]; then
  echo "No legacy Acolyte directory found at $legacy_dir"
  exit 0
fi

move_path() {
  local source="$1"
  local target="$2"

  if [[ ! -e "$source" ]]; then
    return
  fi
  if [[ -e "$target" ]]; then
    echo "Refusing to overwrite existing target: $target" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$target")"
  mv "$source" "$target"
  echo "moved $source -> $target"
}

move_path "$legacy_dir/config.toml" "$config_dir/config.toml"
move_path "$legacy_dir/config.json" "$config_dir/config.json"
move_path "$legacy_dir/credentials" "$config_dir/credentials"
move_path "$legacy_dir/oauth.json" "$config_dir/oauth.json"

move_path "$legacy_dir/memory.db" "$data_dir/memory.db"
move_path "$legacy_dir/memory.db-shm" "$data_dir/memory.db-shm"
move_path "$legacy_dir/memory.db-wal" "$data_dir/memory.db-wal"
move_path "$legacy_dir/memory.json" "$data_dir/memory.json"
move_path "$legacy_dir/memory" "$data_dir/memory"
move_path "$legacy_dir/sessions.json" "$data_dir/sessions.json"
move_path "$legacy_dir/trace.db" "$data_dir/trace.db"
move_path "$legacy_dir/trace.db-shm" "$data_dir/trace.db-shm"
move_path "$legacy_dir/trace.db-wal" "$data_dir/trace.db-wal"
move_path "$legacy_dir/tool.db" "$data_dir/tool.db"
move_path "$legacy_dir/tool.db-shm" "$data_dir/tool.db-shm"
move_path "$legacy_dir/tool.db-wal" "$data_dir/tool.db-wal"
move_path "$legacy_dir/projects" "$data_dir/projects"

move_path "$legacy_dir/daemons" "$state_dir/daemons"
move_path "$legacy_dir/locks" "$state_dir/locks"
move_path "$legacy_dir/client.log" "$state_dir/client.log"
move_path "$legacy_dir/server.log" "$state_dir/server.log"
move_path "$legacy_dir/prompt.log" "$state_dir/prompt.log"
move_path "$legacy_dir/update-check.json" "$state_dir/update-check.json"
move_path "$legacy_dir/dogfood-gate-history.json" "$state_dir/dogfood-gate-history.json"

move_path "$legacy_dir/bin/acolyte" "$bin_dir/acolyte"
rmdir "$legacy_dir/bin" 2>/dev/null || true

if find "$legacy_dir" -mindepth 1 -print -quit | grep -q .; then
  echo "Legacy directory still contains unmigrated files:" >&2
  find "$legacy_dir" -mindepth 1 -maxdepth 2 -print >&2
  exit 1
fi

rmdir "$legacy_dir" 2>/dev/null || true

echo "Acolyte macOS XDG migration complete."
