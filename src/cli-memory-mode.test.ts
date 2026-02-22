import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMemory } from "./memory";

const tmpHomes: string[] = [];
const tmpProjects: string[] = [];
const repoRoot = process.cwd();

afterEach(async () => {
  while (tmpHomes.length > 0) {
    const dir = tmpHomes.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
  while (tmpProjects.length > 0) {
    const dir = tmpProjects.pop();
    if (!dir) {
      continue;
    }
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

describe("cli memory mode", () => {
  test("memory context handles empty state", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });

    const result = runCli(home, project, "memory", "context");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("memory_context: 0");
    expect(result.stdout).toContain("No memories saved.");
  });

  test("memory context shows injected memory count and entries", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await mkdir(join(project, ".acolyte"), { recursive: true });

    await addMemory("prefer concise answers", { scope: "user", homeDir: home, cwd: project });
    await addMemory("use bun run verify", { scope: "project", homeDir: home, cwd: project });

    const result = runCli(home, project, "memory", "context");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("memory_context: 2");
    expect(result.stdout).toContain("scope:   project");
    expect(result.stdout).toContain("scope:   user");
    expect(result.stdout.indexOf("use bun run verify")).toBeLessThan(result.stdout.indexOf("prefer concise answers"));
  });

  test("memory list supports scope filtering", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await mkdir(join(project, ".acolyte"), { recursive: true });

    await addMemory("global pref", { scope: "user", homeDir: home, cwd: project });
    await addMemory("repo convention", { scope: "project", homeDir: home, cwd: project });

    const userOnly = runCli(home, project, "memory", "list", "user");
    expect(userOnly.exitCode).toBe(0);
    expect(userOnly.stdout).toContain("scope: user");
    expect(userOnly.stdout).toContain("memories: 1");
    expect(userOnly.stdout).toContain("global pref");
    expect(userOnly.stdout).not.toContain("repo convention");
  });

  test("memory mode rejects unknown subcommands", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-memory-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });

    const result = runCli(home, project, "memory", "foo");
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Usage: acolyte memory [list [all|user|project]|context|add [--user|--project] <text>]",
    );
  });
});
