import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "./storage";
import type { SessionStore } from "./types";

const tmpHomes: string[] = [];

afterEach(async () => {
  while (tmpHomes.length > 0) {
    const dir = tmpHomes.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("cli run mode", () => {
  test("run command does not mutate persisted sessions", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-run-test-"));
    tmpHomes.push(home);
    const dataDir = join(home, ".acolyte");
    await mkdir(dataDir, { recursive: true });

    const existing = createSession("gpt-5-mini");
    existing.title = "Persisted Session";
    const store: SessionStore = {
      sessions: [existing],
      activeSessionId: existing.id,
    };
    const storePath = join(dataDir, "sessions.json");
    const before = JSON.stringify(store, null, 2);
    await writeFile(storePath, before, "utf8");

    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "run", "hello"],
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const after = await readFile(storePath, "utf8");
    expect(after).toBe(before);
  });

  test("run command exits non-zero when remote backend is unreachable", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-run-fail-test-"));
    tmpHomes.push(home);
    const dataDir = join(home, ".acolyte");
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify(
        {
          apiUrl: "http://127.0.0.1:1",
          model: "gpt-5-mini",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/cli.ts", "run", "hello"],
      cwd: process.cwd(),
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
    expect(stdout).toContain("Cannot reach backend at http://127.0.0.1:1");
  });
});
