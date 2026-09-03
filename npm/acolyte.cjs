#!/usr/bin/env node
// npm resolves the platform package only at run time, so this hands the launcher its baseline
// through the environment. Which build actually runs stays the launcher's decision.
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const PLATFORM_PACKAGES = {
  "darwin-arm64": "@acolyte/darwin-arm64",
  "linux-x64": "@acolyte/linux-x64",
};

const platform = `${process.platform}-${process.arch}`;
const platformPackage = PLATFORM_PACKAGES[platform];
if (!platformPackage) {
  console.error(`acolyte: no build for ${platform}. Acolyte ships macOS arm64 and Linux x64.`);
  process.exit(1);
}

let baseline;
try {
  baseline = require.resolve(`${platformPackage}/acolyte`);
} catch {
  console.error(`acolyte: ${platformPackage} is missing. Reinstall @acolyte/cli with optional dependencies enabled.`);
  process.exit(1);
}

const result = spawnSync(join(__dirname, "..", "launcher.sh"), process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    ACOLYTE_BASELINE_BIN: baseline,
    ACOLYTE_BASELINE_VERSION: require("../package.json").version,
  },
});

if (result.error) {
  console.error(`acolyte: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
