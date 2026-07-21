#!/usr/bin/env bash
set -euo pipefail

outfile="${1:-acolyte}"
version=$(bun -e 'console.log(require("./package.json").version)')

bun build --compile src/cli.ts \
  --outfile "$outfile" \
  --external react-devtools-core \
  --define "process.env.ACOLYTE_COMPILED_VERSION=\"${version}\""
