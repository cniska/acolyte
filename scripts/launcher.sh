#!/usr/bin/env sh
# Acolyte launcher. Execs the newest of the binary this install owns and the builds staged in the
# data directory, so an update only ever writes to the data directory and never to a file an
# installer or package manager owns. Installers substitute the two placeholders below.
set -eu

BASELINE_BIN="__BASELINE_BIN__"
BASELINE_VERSION="__BASELINE_VERSION__"

# Mirrors src/paths.ts: a relative XDG_DATA_HOME is ignored. Neither variable is required — with
# no home to read, the baseline binary still runs.
data_home="${XDG_DATA_HOME:-}"
case "$data_home" in
  /*) ;;
  *) data_home="${HOME:-}/.local/share" ;;
esac
staged_dir="${data_home}/acolyte/bin"

# Prints whichever of two dotted versions sorts higher, the first argument on a tie.
version_max() {
  printf '%s\n%s\n' "$1" "$2" | awk -F. '
    { v[NR] = $0; for (i = 1; i <= 3; i++) f[NR, i] = $i + 0 }
    END {
      for (i = 1; i <= 3; i++) {
        if (f[1, i] > f[2, i]) { print v[1]; exit }
        if (f[1, i] < f[2, i]) { print v[2]; exit }
      }
      print v[1]
    }
  '
}

target="$BASELINE_BIN"
target_version="$BASELINE_VERSION"

for candidate in "$staged_dir"/*/acolyte; do
  if [ -x "$candidate" ]; then
    candidate_version="$(basename "$(dirname "$candidate")")"
    if [ "$(version_max "$target_version" "$candidate_version")" != "$target_version" ]; then
      target="$candidate"
      target_version="$candidate_version"
    fi
  fi
done

if [ ! -x "$target" ]; then
  echo "acolyte: no runnable binary at ${target}. Reinstall Acolyte." >&2
  exit 1
fi

exec "$target" "$@"
