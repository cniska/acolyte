import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { gitEnv, tempDir, writeGitOrigin } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

/** Runs the CLI the way a user does: in their workspace, against an isolated home. */
async function runCli(cwd: string, home: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "cli.ts"), ...args],
    cwd,
    env: gitEnv({
      XDG_DATA_HOME: join(home, "data"),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_STATE_HOME: join(home, "state"),
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { code, stdout: `${stdout}${stderr}` };
}

describe("acolyte memory add", () => {
  test("stores a project memory under the workspace's repository, not a hash of its path", async () => {
    const home = dirs.createDir("acolyte-cli-memory-home-");
    const workspace = dirs.createDir("acolyte-cli-memory-ws-");
    writeGitOrigin(workspace, "git@github.com:owner/repo.git");

    const added = await runCli(workspace, home, ["memory", "add", "--project", "prefer bun run verify"]);
    expect(added.code, added.stdout).toBe(0);

    const db = new Database(join(home, "data", "acolyte", "memory.db"), { readonly: true });
    const rows = db.query<{ scope_key: string; content: string }, []>("SELECT scope_key, content FROM memories").all();
    db.close();

    expect(rows).toEqual([{ scope_key: "proj_b0a93768b870", content: "prefer bun run verify" }]);
  });

  test("refuses a project memory in a workspace with no remote, and says why", async () => {
    const home = dirs.createDir("acolyte-cli-memory-home-");
    const workspace = dirs.createDir("acolyte-cli-memory-bare-");

    const added = await runCli(workspace, home, ["memory", "add", "--project", "nowhere to put this"]);

    expect(added.stdout).toContain("no git remote");
  });
});
