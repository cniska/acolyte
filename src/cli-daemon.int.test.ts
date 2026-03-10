import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHomes: string[] = [];
const tmpProjects: string[] = [];
const repoRoot = process.cwd();
const TEST_PORT = 26767;

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
  const home = await mkdtemp(join(tmpdir(), "acolyte-cli-daemon-home-"));
  const project = await mkdtemp(join(tmpdir(), "acolyte-cli-daemon-project-"));
  tmpHomes.push(home);
  tmpProjects.push(project);
  const acolyteDir = join(home, ".acolyte");
  await mkdir(acolyteDir, { recursive: true });
  await writeFile(join(acolyteDir, "config.toml"), `port = ${TEST_PORT}\n`, "utf8");
  return { home, project };
}

describe("cli daemon lifecycle", () => {
  test("start/stop/restart produce expected output", async () => {
    const { home, project } = await createTestEnv();
    const out = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

    const startResult = runCli(home, project, "start");
    expect(startResult.exitCode).toBe(0);
    expect(out(startResult)).toContain(`server on port ${TEST_PORT}`);

    const restartResult = runCli(home, project, "restart");
    expect(restartResult.exitCode).toBe(0);
    expect(out(restartResult)).toContain(`server on port ${TEST_PORT}`);

    const stopResult = runCli(home, project, "stop");
    expect(stopResult.exitCode).toBe(0);
    expect(out(stopResult)).toContain(`server on port ${TEST_PORT}`);
  });

  test("ps lists running daemons", async () => {
    const { home, project } = await createTestEnv();
    const out = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

    runCli(home, project, "start");
    const psResult = runCli(home, project, "ps");
    expect(psResult.exitCode).toBe(0);
    expect(out(psResult)).toContain("PORT");
    expect(out(psResult)).toContain(String(TEST_PORT));
    runCli(home, project, "stop");
  });
});
