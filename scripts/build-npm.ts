#!/usr/bin/env bun
// Assembles the npm publish tree: one package per platform holding that platform's binary, and
// @acolyte/cli holding the launcher and the shim that hands it the resolved binary.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

export interface Platform {
  readonly os: string;
  readonly cpu: string;
  readonly description: string;
}

export const PLATFORMS: readonly Platform[] = [
  { os: "darwin", cpu: "arm64", description: "macOS arm64 binary for Acolyte." },
  { os: "linux", cpu: "x64", description: "Linux x64 binary for Acolyte." },
];

// The release build matrix, the release tarball, and the package the npm shim resolves at run
// time all name a platform this way, so naming it once here keeps them from drifting apart.
export const platformTarget = (platform: Platform): string => `${platform.os}-${platform.cpu}`;
export const platformPackage = (platform: Platform): string => `@acolyte/${platformTarget(platform)}`;
export const platformTarball = (platform: Platform): string => `acolyte-${platformTarget(platform)}.tar.gz`;

const REPOSITORY = {
  type: "git",
  url: "git+https://github.com/cniska/acolyte.git",
};

export function createPlatformManifest(platform: Platform, version: string): Record<string, unknown> {
  return {
    name: platformPackage(platform),
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
    optionalDependencies: Object.fromEntries(platforms.map((platform) => [platformPackage(platform), version])),
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
    const packageDir = join(outDir, platformTarget(platform));
    mkdirSync(packageDir, { recursive: true });
    extractBinary(join(artifactsDir, platformTarball(platform)), packageDir);
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
