#!/bin/sh
// 2>/dev/null; for rt in node bun; do command -v "$rt" >/dev/null 2>&1 && exec "$rt" "$0" "$@"; done; echo "acolyte: install Node or Bun to run this" >&2; exit 1
// The line above runs under /bin/sh and reads as a comment under the runtime it hands off to, so
// an install that has Bun but no Node still works.
//
// npm resolves the platform package only at run time, so this hands the launcher its baseline
// through the environment. Which build actually runs stays the launcher's decision.
const { spawn } = require("node:child_process");
const { join } = require("node:path");

const manifest = require("../package.json");
const supported = Object.keys(manifest.optionalDependencies);
const platformPackage = `@acolyte/${process.platform}-${process.arch}`;

if (!supported.includes(platformPackage)) {
  console.error(`acolyte: no build for ${platformPackage}. Acolyte ships ${supported.join(" and ")}.`);
  process.exit(1);
}

let baseline;
try {
  baseline = require.resolve(`${platformPackage}/acolyte`);
} catch {
  console.error(`acolyte: ${platformPackage} is missing. Reinstall @acolyte/cli with optional dependencies enabled.`);
  process.exit(1);
}

const child = spawn(join(__dirname, "..", "launcher.sh"), process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    ACOLYTE_BASELINE_BIN: baseline,
    ACOLYTE_BASELINE_VERSION: manifest.version,
  },
});

// A signal aimed at this wrapper alone, as a service manager or a bare `kill` sends it, still has
// to reach the binary: that is the process holding the terminal and the one that restores it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`acolyte: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
