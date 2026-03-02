import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
const repoRoot = process.cwd();

afterEach(cleanupDirs);

describe("cli run mode", () => {
  test("run command reports local server bootstrap/reuse when apiUrl is not configured", async () => {
    const home = createDir("acolyte-run-test-");
    const project = createDir("acolyte-run-project-");
    const userDataDir = join(home, ".acolyte");
    await mkdir(userDataDir, { recursive: true });

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

    const stdout = Buffer.from(result.stdout).toString("utf8");
    expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
    expect(stdout).toContain("local server at http://127.0.0.1:");
  }, 15_000);
});
