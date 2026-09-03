#!/usr/bin/env bun
// Assembles the npm publish tree: one package per platform holding that platform's binary, and
// @acolyte/cli holding the launcher and the shim that hands it the resolved binary.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

export interface Platform {
  readonly directory: string;
  readonly package: string;
  readonly os: string;
  readonly cpu: string;
  readonly description: string;
  readonly tarball: string;
}

export const PLATFORMS: readonly Platform[] = [
  {
    directory: "darwin-arm64",
    package: "@acolyte/darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    description: "macOS arm64 binary for Acolyte.",
    tarball: "acolyte-darwin-arm64.tar.gz",
  },
  {
    directory: "linux-x64",
    package: "@acolyte/linux-x64",
    os: "linux",
    cpu: "x64",
    description: "Linux x64 binary for Acolyte.",
    tarball: "acolyte-linux-x64.tar.gz",
  },
];

const REPOSITORY = {
  type: "git",
  url: "git+https://github.com/cniska/acolyte.git",
};

export function createPlatformManifest(platform: Platform, version: string): Record<string, unknown> {
  return {
    name: platform.package,
    version,
    description: platform.description,
    license: "MIT",
    homepage: "https://acolyte.sh",
    repository: REPOSITORY,
    os: [platform.os],
    cpu: [platform.cpu],
    files: ["acolyte"],
  };
}

export function createCliManifest(version: string, platforms: readonly Platform[]): Record<string, unknown> {
  return {
    name: "@acolyte/cli",
    version,
    description: "The agent that knows you. An open-source AI coding agent for the terminal.",
    license: "MIT",
    homepage: "https://acolyte.sh",
    repository: REPOSITORY,
    bugs: { url: "https://github.com/cniska/acolyte/issues" },
    keywords: ["ai", "agent", "cli", "coding-agent", "terminal", "tui"],
    bin: { acolyte: "bin/acolyte.cjs" },
    files: ["bin/acolyte.cjs", "launcher.sh"],
    engines: { node: ">=20" },
    optionalDependencies: Object.fromEntries(platforms.map((platform) => [platform.package, version])),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function copy(from: string, to: string): Promise<void> {
  await Bun.write(to, Bun.file(from));
}

function extractBinary(tarball: string, into: string): void {
  const result = spawnSync("tar", ["-xzf", tarball, "-C", into, "acolyte"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`failed to extract ${basename(tarball)}`);
}

async function main(artifactsDir: string, outDir: string): Promise<void> {
  const root = join(import.meta.dir, "..");
  const { version } = await Bun.file(join(root, "package.json")).json();

  rmSync(outDir, { recursive: true, force: true });

  for (const platform of PLATFORMS) {
    const packageDir = join(outDir, platform.directory);
    mkdirSync(packageDir, { recursive: true });
    extractBinary(join(artifactsDir, platform.tarball), packageDir);
    await writeJson(join(packageDir, "package.json"), createPlatformManifest(platform, version));
  }

  const cliDir = join(outDir, "cli");
  mkdirSync(join(cliDir, "bin"), { recursive: true });
  await writeJson(join(cliDir, "package.json"), createCliManifest(version, PLATFORMS));
  await copy(join(root, "npm", "acolyte.cjs"), join(cliDir, "bin", "acolyte.cjs"));
  await copy(join(root, "scripts", "launcher.sh"), join(cliDir, "launcher.sh"));
  await copy(join(root, "README.md"), join(cliDir, "README.md"));
  await copy(join(root, "LICENSE"), join(cliDir, "LICENSE"));
  await Bun.$`chmod +x ${join(cliDir, "bin", "acolyte.cjs")} ${join(cliDir, "launcher.sh")}`.quiet();

  console.log(`${outDir}: @acolyte/cli ${version} and ${PLATFORMS.length} platform packages`);
}

if (import.meta.main) {
  const [artifactsDir, outDir] = process.argv.slice(2);
  if (!artifactsDir || !outDir) {
    console.error("Usage: build-npm.ts <artifacts-dir> <out-dir>");
    process.exit(1);
  }
  await main(artifactsDir, outDir);
}
