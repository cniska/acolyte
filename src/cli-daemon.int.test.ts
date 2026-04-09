import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reserveFreePort } from "../scripts/port-utils";
import { configDir } from "./paths";
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

async function createTestEnv(): Promise<{ home: string; project: string; port: number }> {
  const home = dirs.createDir("acolyte-cli-daemon-home-");
  const project = dirs.createDir("acolyte-cli-daemon-project-");
  const testConfigDir = configDir({ HOME: home });
  await mkdir(testConfigDir, { recursive: true });
  const port = reserveFreePort();
  await writeFile(join(testConfigDir, "config.toml"), `port = ${port}\n`, "utf8");
  return { home, project, port };
}

describe("cli daemon lifecycle", () => {
  test("start/stop/restart produce expected output", async () => {
    const { home, project, port } = await createTestEnv();
    const out = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

    const startResult = runCli(home, project, "start");
    expect(startResult.exitCode).toBe(0);
    expect(out(startResult)).toContain(`server on port ${port}`);

    const restartResult = runCli(home, project, "restart");
    expect(restartResult.exitCode).toBe(0);
    expect(out(restartResult)).toContain(`server on port ${port}`);

    const stopResult = runCli(home, project, "stop");
    expect(stopResult.exitCode).toBe(0);
    expect(out(stopResult)).toContain(`server on port ${port}`);
  });

  test("ps lists running daemons", async () => {
    const { home, project, port } = await createTestEnv();
    const out = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

    runCli(home, project, "start");
    const psResult = runCli(home, project, "ps");
    expect(psResult.exitCode).toBe(0);
    expect(out(psResult)).toContain("Port");
    expect(out(psResult)).toContain(String(port));
    runCli(home, project, "stop");
  });
});
