import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLATFORMS, platformPackage, platformTarball, platformTarget } from "./build-npm";

const BUILD_NPM = join(import.meta.dir, "build-npm.ts");
const HOSTS = PLATFORMS.filter((platform) => platform.os === process.platform && platform.cpu === process.arch);
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0, created.length)) rmSync(dir, { recursive: true, force: true });
});

function createDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function writeShim(path: string, label: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "${label} $*"\n`, { mode: 0o755 });
}

/** Packages a stand-in binary the way the release job packages the real one. */
async function createArtifacts(): Promise<string> {
  const artifacts = createDir("acolyte-npm-artifacts-");
  for (const platform of PLATFORMS) {
    const staging = createDir("acolyte-npm-staging-");
    writeShim(join(staging, "acolyte"), `binary-${platformTarget(platform)}`);
    await Bun.$`tar -czf ${join(artifacts, platformTarball(platform))} -C ${staging} acolyte`.quiet();
  }
  return artifacts;
}

async function build(artifacts: string): Promise<string> {
  const packages = join(createDir("acolyte-npm-out-"), "packages");
  await Bun.$`bun ${BUILD_NPM} ${artifacts} ${packages}`.quiet();
  return packages;
}

/** Lays out the publish tree the way npm lays it out on disk, and returns the shim's path. */
async function install(): Promise<string> {
  const packages = await build(await createArtifacts());
  const modules = join(createDir("acolyte-npm-install-"), "node_modules", "@acolyte");
  mkdirSync(modules, { recursive: true });
  cpSync(join(packages, "cli"), join(modules, "cli"), { recursive: true });
  for (const host of HOSTS) {
    cpSync(join(packages, platformTarget(host)), join(modules, platformTarget(host)), { recursive: true });
  }

  return join(modules, "cli", "bin", "acolyte.cjs");
}

async function run(shim: string, home: string, args: string[] = []): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["node", shim, ...args], {
    env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { out: `${out}${err}`.trim(), code: await proc.exited };
}

describe("npm package build", () => {
  test("ships the command and the launcher executable", async () => {
    const packages = await build(await createArtifacts());

    for (const path of [join(packages, "cli", "bin", "acolyte.cjs"), join(packages, "cli", "launcher.sh")]) {
      expect(statSync(path).mode & 0o111).toBeGreaterThan(0);
    }
  });

  test("fails when a platform's release artifact is missing", async () => {
    const artifacts = await createArtifacts();
    rmSync(join(artifacts, platformTarball(PLATFORMS[0])));

    const proc = Bun.spawn(["bun", BUILD_NPM, artifacts, join(createDir("acolyte-npm-out-"), "packages")], {
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await proc.exited).not.toBe(0);
  });
});

// Skips itself on a platform Acolyte ships no binary for, where there is nothing to install.
for (const host of HOSTS) {
  describe("npm package", () => {
    test("runs this platform's binary and forwards arguments", async () => {
      const result = await run(await install(), createDir("acolyte-npm-home-"), ["run", "hello"]);

      expect(result).toEqual({ out: `binary-${platformTarget(host)} run hello`, code: 0 });
    });

    test("runs a staged build that is newer than the packaged binary", async () => {
      const shim = await install();
      const home = createDir("acolyte-npm-home-");
      writeShim(join(home, ".local", "share", "acolyte", "bin", "99.0.0", "acolyte"), "staged-99.0.0");

      expect(await run(shim, home)).toEqual({ out: "staged-99.0.0", code: 0 });
    });

    test("runs under Bun when the machine has no Node", async () => {
      const shim = await install();
      const path = createDir("acolyte-npm-path-");
      for (const tool of ["bun", "sh", "awk", "basename", "dirname"]) {
        const resolved = Bun.which(tool);
        if (resolved) symlinkSync(resolved, join(path, tool));
      }
      if (Bun.which("node", { PATH: path })) throw new Error("node is still reachable, so this proves nothing");

      const proc = Bun.spawn([shim, "run", "hello"], {
        env: { HOME: createDir("acolyte-npm-home-"), PATH: path },
        stdout: "pipe",
      });
      expect((await new Response(proc.stdout).text()).trim()).toBe(`binary-${platformTarget(host)} run hello`);
      expect(await proc.exited).toBe(0);
    });

    test("fails loudly when the platform package is missing", async () => {
      const shim = await install();
      rmSync(join(shim, "..", "..", "..", platformTarget(host)), { recursive: true, force: true });

      const result = await run(shim, createDir("acolyte-npm-home-"));
      expect(result.code).toBe(1);
      expect(result.out).toContain(`${platformPackage(host)} is missing`);
    });
  });
}
