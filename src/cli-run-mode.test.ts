import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "./storage";
import type { SessionStore } from "./types";

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
  test("run command does not mutate persisted sessions", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-run-test-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-run-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
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
      cmd: [process.execPath, "run", join(repoRoot, "src/cli.ts"), "run", "hello"],
      cwd: project,
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
    expect(stdout).toContain("Cannot reach backend at http://127.0.0.1:1");
  });

  test("run command times out when backend chat reply hangs", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-run-timeout-test-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-run-timeout-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);

    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/v1/chat") {
          return new Promise<Response>(() => {});
        }
        return new Response("ok");
      },
    });

    try {
      const userDataDir = join(home, ".acolyte");
      const projectDataDir = join(project, ".acolyte");
      await mkdir(userDataDir, { recursive: true });
      await mkdir(projectDataDir, { recursive: true });
      await writeFile(
        join(projectDataDir, "config.toml"),
        `apiUrl = "http://127.0.0.1:${server.port}"\nmodel = "gpt-5-mini"\n`,
        "utf8",
      );

      const result = Bun.spawnSync({
        cmd: [process.execPath, "run", join(repoRoot, "src/cli.ts"), "run", "hello"],
        cwd: project,
        env: {
          ...process.env,
          HOME: home,
          NO_COLOR: "1",
          ACOLYTE_RUN_REPLY_TIMEOUT_MS: "40",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = Buffer.from(result.stdout).toString("utf8");
      expect(result.exitCode).toBe(1);
      expect(stdout).toContain("Remote backend reply timed out after 40ms");
    } finally {
      server.stop(true);
    }
  });
});
