import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("cli config mode", () => {
  test("config set writes user scope by default", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-config-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-config-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });

    const setResult = runCli(home, project, "config", "set", "model", "openai/gpt-5-mini");
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toContain("Saved config model (user).");

    const userToml = await readFile(join(home, ".acolyte", "config.toml"), "utf8");
    expect(userToml).toContain('model = "openai/gpt-5-mini"');
  });

  test("config set --project writes project scope", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-config-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-config-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await mkdir(join(project, ".acolyte"), { recursive: true });

    const setResult = runCli(home, project, "config", "set", "--project", "model", "anthropic/claude-sonnet-4");
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toContain("Saved config model (project).");

    const projectToml = await readFile(join(project, ".acolyte", "config.toml"), "utf8");
    expect(projectToml).toContain('model = "anthropic/claude-sonnet-4"');
  });

  test("config list shows effective scope and merged precedence", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-config-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-config-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await mkdir(join(project, ".acolyte"), { recursive: true });

    expect(runCli(home, project, "config", "set", "--user", "model", "openai/gpt-5-mini").exitCode).toBe(0);
    expect(runCli(home, project, "config", "set", "--project", "model", "anthropic/claude-sonnet-4").exitCode).toBe(0);

    const listResult = runCli(home, project, "config", "list");
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("scope=effective");
    expect(listResult.stdout).toContain("model=anthropic/claude-sonnet-4");
  });

  test("config set rejects invalid values", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-config-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-config-cli-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await mkdir(join(home, ".acolyte"), { recursive: true });

    const result = runCli(home, project, "config", "set", "maxMessageTokens", "not-a-number");
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Invalid value for maxMessageTokens");
  });
});
