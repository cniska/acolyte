import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("cli run mode", () => {
  test("run command exits non-zero when no server is configured", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-run-test-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-run-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    const dataDir = join(home, ".acolyte");
    await mkdir(dataDir, { recursive: true });

    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", join(repoRoot, "src/cli.ts"), "run", "hello"],
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = Buffer.from(result.stderr).toString("utf8");
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("No API URL configured");
  });

  test("run command exits non-zero when remote server is unreachable", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-run-fail-test-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-run-fail-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    await mkdir(userDataDir, { recursive: true });
    await mkdir(projectDataDir, { recursive: true });
    await writeFile(
      join(projectDataDir, "config.toml"),
      'apiUrl = "http://127.0.0.1:1"\nmodel = "gpt-5-mini"\n',
      "utf8",
    );

    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", join(repoRoot, "src/cli.ts"), "run", "hello"],
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = Buffer.from(result.stdout).toString("utf8");
    expect(result.exitCode).toBe(1);
    expect(stdout).toContain("Cannot reach server at http://127.0.0.1:1");
  });
});
