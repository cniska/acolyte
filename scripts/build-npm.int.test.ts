import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLATFORMS } from "./build-npm";

const BUILD_NPM = join(import.meta.dir, "build-npm.ts");
const HOST = PLATFORMS.find((platform) => platform.os === process.platform && platform.cpu === process.arch);
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
    writeShim(join(staging, "acolyte"), `binary-${platform.directory}`);
    await Bun.$`tar -czf ${join(artifacts, platform.tarball)} -C ${staging} acolyte`.quiet();
  }
  return artifacts;
}

/** Lays out the publish tree the way npm lays it out on disk, and returns the shim's path. */
async function install(): Promise<string> {
  const out = createDir("acolyte-npm-out-");
  await Bun.$`bun ${BUILD_NPM} ${await createArtifacts()} ${join(out, "packages")}`.quiet();

  const modules = join(createDir("acolyte-npm-install-"), "node_modules", "@acolyte");
  mkdirSync(modules, { recursive: true });
  cpSync(join(out, "packages", "cli"), join(modules, "cli"), { recursive: true });
  if (HOST) cpSync(join(out, "packages", HOST.directory), join(modules, HOST.directory), { recursive: true });

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

describe.if(HOST !== undefined)("npm package", () => {
  test("runs this platform's binary and forwards arguments", async () => {
    const result = await run(await install(), createDir("acolyte-npm-home-"), ["run", "hello"]);

    expect(result).toEqual({ out: `binary-${HOST?.directory} run hello`, code: 0 });
  });

  test("runs a staged build that is newer than the packaged binary", async () => {
    const shim = await install();
    const home = createDir("acolyte-npm-home-");
    writeShim(join(home, ".local", "share", "acolyte", "bin", "99.0.0", "acolyte"), "staged-99.0.0");

    expect(await run(shim, home)).toEqual({ out: "staged-99.0.0", code: 0 });
  });

  test("fails loudly when the platform package is missing", async () => {
    const shim = await install();
    rmSync(join(shim, "..", "..", "..", HOST?.directory ?? ""), { recursive: true, force: true });

    const result = await run(shim, createDir("acolyte-npm-home-"));
    expect(result.code).toBe(1);
    expect(result.out).toContain(`${HOST?.package} is missing`);
  });
});
