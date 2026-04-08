import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";

const dirs = tempDir();
const repoRoot = process.cwd();

afterEach(dirs.cleanupDirs);

function runCli(
  home: string,
  project: string,
  ...args: string[]
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", join(repoRoot, "src/cli.ts"), ...args],
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: Buffer.from(result.stdout).toString("utf8"),
    stderr: Buffer.from(result.stderr).toString("utf8"),
  };
}

async function createTestEnv(): Promise<{ home: string; project: string }> {
  const home = dirs.createDir("acolyte-cli-help-home-");
  const project = dirs.createDir("acolyte-cli-help-project-");
  await mkdir(join(home, ".acolyte"), { recursive: true });
  return { home, project };
}

describe("cli subcommand help", () => {
  test("all subcommands accept --help", async () => {
    const { home, project } = await createTestEnv();
    const subcommands = [
      "init",
      "resume",
      "run",
      "history",
      "start",
      "stop",
      "restart",
      "ps",
      "status",
      "memory",
      "config",
      "tool",
    ] as const;

    for (const subcommand of subcommands) {
      const result = runCli(home, project, subcommand, "--help");
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.exitCode).toBe(0);
      expect(output).toContain(`Usage: acolyte ${subcommand}`);
    }
  }, 10_000);

  test("start help does not start server", async () => {
    const { home, project } = await createTestEnv();
    const result = runCli(home, project, "start", "help");
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Usage: acolyte start");
    expect(output).not.toContain("Acolyte server listening");
  });

  test("history and status help aliases print usage", async () => {
    const { home, project } = await createTestEnv();
    const cases = [
      { subcommand: "history", flag: "help" },
      { subcommand: "status", flag: "-h" },
    ] as const;
    for (const check of cases) {
      const result = runCli(home, project, check.subcommand, check.flag);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.exitCode).toBe(0);
      expect(output).toContain(`Usage: acolyte ${check.subcommand}`);
    }
  });

  test("zero-arg subcommands reject unexpected arguments", async () => {
    const { home, project } = await createTestEnv();
    const subcommands = ["history", "status"] as const;

    for (const subcommand of subcommands) {
      const result = runCli(home, project, subcommand, "unexpected");
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.exitCode).toBe(1);
      expect(output).toContain(`Usage: acolyte ${subcommand}`);
    }
  });
});
