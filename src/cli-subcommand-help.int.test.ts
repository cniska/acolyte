import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHomes: string[] = [];
const tmpProjects: string[] = [];
const repoRoot = process.cwd();

afterEach(async () => {
  while (tmpHomes.length > 0) {
    const dir = tmpHomes.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
  while (tmpProjects.length > 0) {
    const dir = tmpProjects.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

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
  const home = await mkdtemp(join(tmpdir(), "acolyte-cli-help-home-"));
  const project = await mkdtemp(join(tmpdir(), "acolyte-cli-help-project-"));
  tmpHomes.push(home);
  tmpProjects.push(project);
  await mkdir(join(home, ".acolyte"), { recursive: true });
  return { home, project };
}

describe("cli subcommand help", () => {
  test("all subcommands accept --help", async () => {
    const { home, project } = await createTestEnv();
    const subcommands = ["init", "resume", "run", "history", "server", "status", "memory", "config", "tool"] as const;

    for (const subcommand of subcommands) {
      const result = runCli(home, project, subcommand, "--help");
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.exitCode).toBe(0);
      expect(output).toContain(`Usage: acolyte ${subcommand}`);
    }
  }, 10_000);

  test("server help does not start server", async () => {
    const { home, project } = await createTestEnv();
    const result = runCli(home, project, "server", "help");
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Usage: acolyte server");
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

  test("server supports start/status/stop/restart actions", async () => {
    const { home, project } = await createTestEnv();
    const startResult = runCli(home, project, "server", "start");
    const statusResult = runCli(home, project, "server", "status");
    const restartResult = runCli(home, project, "server", "restart");
    const stopResult = runCli(home, project, "server", "stop");
    expect(startResult.exitCode).toBe(0);
    expect(`${startResult.stdout}\n${startResult.stderr}`).toMatch(/(Started|Using( external)?) local server at /);
    expect(statusResult.exitCode).toBe(0);
    expect(`${statusResult.stdout}\n${statusResult.stderr}`).toMatch(/Local server running \((pid( \d+)?|external)\)/);
    expect(restartResult.exitCode).toBe(0);
    expect(`${restartResult.stdout}\n${restartResult.stderr}`).toMatch(
      /(Started|Using( external)?) local server at |Local server is running as an external process/,
    );
    expect(stopResult.exitCode).toBe(0);
    expect(`${stopResult.stdout}\n${stopResult.stderr}`).toMatch(
      /(Stopped local server\.|Local server is not running\.|Local server is running as an external process)/,
    );
  });
});
