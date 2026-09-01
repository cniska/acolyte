import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMPLATE = join(import.meta.dir, "launcher.sh");
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0, created.length)) rmSync(dir, { recursive: true, force: true });
});

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), "acolyte-launcher-"));
  created.push(home);
  return home;
}

function writeShim(path: string, label: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "${label} $*"\n`, { mode: 0o755 });
}

function writeBaseline(home: string, version: string): string {
  const path = join(home, ".local", "lib", "acolyte", "acolyte");
  writeShim(path, `baseline-${version}`);
  return path;
}

function writeStaged(home: string, version: string, mode = 0o755): void {
  const path = join(home, ".local", "share", "acolyte", "bin", version, "acolyte");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "staged-${version} $*"\n`, { mode });
}

function installLauncher(home: string, baselinePath: string, baselineVersion: string): string {
  const launcher = join(home, ".local", "bin", "acolyte");
  const body = readFileSync(TEMPLATE, "utf8")
    .replaceAll("__BASELINE_BIN__", baselinePath)
    .replaceAll("__BASELINE_VERSION__", baselineVersion);
  mkdirSync(join(launcher, ".."), { recursive: true });
  writeFileSync(launcher, body, { mode: 0o755 });
  return launcher;
}

async function run(launcher: string, home: string, args: string[] = []): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn([launcher, ...args], {
    env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { out: `${out}${err}`.trim(), code: await proc.exited };
}

describe("launcher", () => {
  test("declares exactly the placeholders the install script fills in", () => {
    const declared = new Set(readFileSync(TEMPLATE, "utf8").match(/__[A-Z_]+__/g));
    const filled = new Set(readFileSync(join(import.meta.dir, "install.sh"), "utf8").match(/__[A-Z_]+__/g));

    expect([...declared].sort()).toEqual(["__BASELINE_BIN__", "__BASELINE_VERSION__"]);
    expect([...filled].sort()).toEqual([...declared].sort());
  });

  test("runs the baseline binary when nothing is staged", async () => {
    const home = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.12.0"), "0.12.0");

    expect(await run(launcher, home)).toEqual({ out: "baseline-0.12.0", code: 0 });
  });

  test("runs a staged build that is newer than the baseline", async () => {
    const home = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.12.0"), "0.12.0");
    writeStaged(home, "0.13.0");

    expect(await run(launcher, home)).toEqual({ out: "staged-0.13.0", code: 0 });
  });

  test("runs the newest of several staged builds", async () => {
    const home = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.12.0"), "0.12.0");
    writeStaged(home, "0.13.0");
    writeStaged(home, "0.9.0");
    writeStaged(home, "1.2.3");

    expect(await run(launcher, home)).toEqual({ out: "staged-1.2.3", code: 0 });
  });

  test("keeps the baseline when it is newer than everything staged", async () => {
    const home = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.14.0"), "0.14.0");
    writeStaged(home, "0.13.0");

    expect(await run(launcher, home)).toEqual({ out: "baseline-0.14.0", code: 0 });
  });

  test("keeps the baseline when the staged build is not executable", async () => {
    const home = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.12.0"), "0.12.0");
    writeStaged(home, "0.13.0", 0o644);

    expect(await run(launcher, home)).toEqual({ out: "baseline-0.12.0", code: 0 });
  });

  test("reads staged builds from an absolute XDG_DATA_HOME", async () => {
    const home = createHome();
    const dataHome = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.12.0"), "0.12.0");
    writeShim(join(dataHome, "acolyte", "bin", "0.13.0", "acolyte"), "xdg-staged-0.13.0");

    const proc = Bun.spawn([launcher], {
      env: { HOME: home, XDG_DATA_HOME: dataHome, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdout: "pipe",
    });
    expect((await new Response(proc.stdout).text()).trim()).toBe("xdg-staged-0.13.0");
    expect(await proc.exited).toBe(0);
  });

  test("forwards arguments to the binary it runs", async () => {
    const home = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.12.0"), "0.12.0");
    writeStaged(home, "0.13.0");

    expect(await run(launcher, home, ["run", "hello"])).toEqual({ out: "staged-0.13.0 run hello", code: 0 });
  });

  test("runs the baseline when the environment names no home", async () => {
    const home = createHome();
    const launcher = installLauncher(home, writeBaseline(home, "0.12.0"), "0.12.0");

    const proc = Bun.spawn([launcher], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdout: "pipe" });
    expect((await new Response(proc.stdout).text()).trim()).toBe("baseline-0.12.0");
    expect(await proc.exited).toBe(0);
  });

  test("fails loudly when the binary it would run is missing", async () => {
    const home = createHome();
    const launcher = installLauncher(home, join(home, ".local", "lib", "acolyte", "acolyte"), "0.12.0");

    const result = await run(launcher, home);
    expect(result.code).toBe(1);
    expect(result.out).toContain("no runnable binary");
  });
});
