import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { gitEnv, startTestServer, tempDir, writeGitOrigin } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

/**
 * The cloud is configured at import — `appConfig` snapshots credentials and config once — so the
 * publish only runs for real in a process started with them.
 */
async function publishIn(workspace: string, cloudUrl: string, token: string): Promise<string> {
  const home = dirs.createDir("acolyte-scope-label-home-");
  await Bun.write(join(home, "acolyte", "config.toml"), "[features]\ncloudSync = true\n");
  const script = [
    `const { publishProjectLabel } = await import(${JSON.stringify(join(import.meta.dir, "scope-label-sync.ts"))});`,
    `await publishProjectLabel(${JSON.stringify(workspace)});`,
    // A second call must not repeat the request: the name is published once per process.
    `await publishProjectLabel(${JSON.stringify(workspace)});`,
  ].join("\n");

  const proc = Bun.spawn({
    cmd: ["bun", "-e", script],
    env: gitEnv({
      XDG_CONFIG_HOME: home,
      XDG_DATA_HOME: home,
      XDG_STATE_HOME: home,
      ACOLYTE_CLOUD_URL: cloudUrl,
      ACOLYTE_CLOUD_TOKEN: token,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited, stderr).toBe(0);
  return stderr;
}

describe("publishProjectLabel", () => {
  test("tells the account what a project scope is called, once", async () => {
    const bodies: unknown[] = [];
    const authorizations: (string | null)[] = [];
    const paths: string[] = [];
    const server = startTestServer(async (request) => {
      paths.push(new URL(request.url).pathname);
      authorizations.push(request.headers.get("authorization"));
      bodies.push(await request.json());
      return new Response(null, { status: 204 });
    });

    try {
      const workspace = dirs.createDir("acolyte-scope-label-repo-");
      writeGitOrigin(workspace, "git@github.com:acolyte-sh/acolyte.git");

      await publishIn(workspace, `http://localhost:${server.port}`, "tok_test");

      expect(paths).toEqual(["/api/v1/scope-labels"]);
      expect(bodies).toEqual([{ scopeKey: "proj_e50d27d3d155", label: "acolyte-sh/acolyte" }]);
      expect(authorizations).toEqual(["Bearer tok_test"]);
    } finally {
      server.stop();
    }
  });

  test("retries after a refused publish, so a transient failure is not final", async () => {
    let refuse = true;
    const attempts: unknown[] = [];
    const server = startTestServer(async (request) => {
      attempts.push(await request.json());
      if (refuse) {
        refuse = false;
        return new Response("nope", { status: 500 });
      }
      return new Response(null, { status: 204 });
    });

    try {
      const workspace = dirs.createDir("acolyte-scope-label-retry-");
      writeGitOrigin(workspace, "git@github.com:acolyte-sh/acolyte.git");

      // Two calls in one process: the first is refused, so the second must try again.
      await publishIn(workspace, `http://localhost:${server.port}`, "tok_test");

      expect(attempts).toHaveLength(2);
    } finally {
      server.stop();
    }
  });

  test("says nothing about a workspace with no project scope", async () => {
    const requests: string[] = [];
    const server = startTestServer(async (request) => {
      requests.push(new URL(request.url).pathname);
      return new Response(null, { status: 204 });
    });

    try {
      const workspace = dirs.createDir("acolyte-scope-label-bare-");

      await publishIn(workspace, `http://localhost:${server.port}`, "tok_test");

      expect(requests).toEqual([]);
    } finally {
      server.stop();
    }
  });
});
