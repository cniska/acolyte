import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createGitFixture, type GitFixture, PLACEHOLDER_IDENTITY, REAL_IDENTITY, ZERO } from "./git-fixture";

let fixture: GitFixture;

function hookEnv(useFakeBun = true, overrides: Record<string, string> = {}): Record<string, string> {
  const base = fixture.env();
  return useFakeBun
    ? fixture.env({ PATH: `${join(fixture.dir, "bin")}:${base.PATH}`, ...overrides })
    : fixture.env(overrides);
}

// Pushing a brand-new branch is the case that regressed: the rev-list range is
// multi-token, so quoting it collapsed the loop and every commit went unchecked.
async function runHookOnNewRef(
  remoteOid = ZERO,
  useFakeBun = true,
  remote = "origin",
): Promise<{ code: number; stderr: string }> {
  const head = fixture.gitOutput(["rev-parse", "HEAD"]);
  const proc = Bun.spawn(["bash", ".githooks/pre-push", remote], {
    cwd: fixture.dir,
    env: hookEnv(useFakeBun),
    stdin: new TextEncoder().encode(`refs/heads/topic ${head} refs/heads/topic ${remoteOid}\n`),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  return { code: await proc.exited, stderr };
}

beforeEach(async () => {
  fixture = await createGitFixture({ prefix: "acolyte-pre-push-", hook: true });
});

afterEach(() => fixture.cleanup());

// Range derivation is the hook's own job; the per-commit rules are covered against
// scripts/check-commits.sh directly.
describe("pre-push hook", () => {
  test("accepts a valid commit on a new branch", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY);
    const { code } = await runHookOnNewRef();
    expect(code).toBe(0);
  });

  test("rejects an offending commit on a new branch", async () => {
    await fixture.commit("feat: add a thing", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("excludes commits already on the remote from a new branch", async () => {
    await fixture.commit("feat: remote", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    const remoteTip = fixture.gitOutput(["rev-parse", "HEAD"]);
    await fixture.git(["remote", "add", "origin", "https://example.com/acolyte.git"]);
    await fixture.git(["update-ref", "refs/remotes/origin/main", remoteTip]);
    await fixture.commit("feat: branch", REAL_IDENTITY);

    const { code } = await runHookOnNewRef();

    expect(code).toBe(0);
  });

  test("checks remote ancestors on a direct URL push", async () => {
    await fixture.commit("feat: remote", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    const remoteTip = fixture.gitOutput(["rev-parse", "HEAD"]);
    await fixture.git(["update-ref", "refs/remotes/origin/main", remoteTip]);
    await fixture.commit("feat: branch", REAL_IDENTITY);

    const { code, stderr } = await runHookOnNewRef(ZERO, true, "https://example.com/acolyte.git");

    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("fails closed when the remote tip is unavailable locally", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY);

    const { code, stderr } = await runHookOnNewRef("1".repeat(40));

    expect(code).toBe(1);
    expect(stderr).toContain("cannot enumerate commits");
  });

  test("does not hand git environment to verify", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY);
    const dump = join(fixture.dir, "verify-env.txt");
    await Bun.write(join(fixture.dir, "bin", "bun"), `#!/bin/sh\nenv > ${dump}\nexit 0\n`);
    Bun.spawnSync(["chmod", "755", join(fixture.dir, "bin", "bun")]);
    const head = fixture.gitOutput(["rev-parse", "HEAD"]);

    const proc = Bun.spawn(["bash", ".githooks/pre-push", "origin"], {
      cwd: fixture.dir,
      env: hookEnv(true, {
        GIT_DIR: join(fixture.dir, ".git"),
        GIT_WORK_TREE: fixture.dir,
        GIT_INDEX_FILE: join(fixture.dir, ".git", "index"),
      }),
      stdin: new TextEncoder().encode(`refs/heads/topic ${head} refs/heads/topic ${ZERO}\n`),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await proc.exited).toBe(0);
    const seen = await Bun.file(dump).text();
    expect(seen).not.toContain("GIT_DIR=");
    expect(seen).not.toContain("GIT_WORK_TREE=");
    expect(seen).not.toContain("GIT_INDEX_FILE=");
  });

  test("skips a deleted ref", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY);
    const proc = Bun.spawn(["bash", ".githooks/pre-push", "origin"], {
      cwd: fixture.dir,
      env: hookEnv(),
      stdin: new TextEncoder().encode(`(delete) ${ZERO} refs/heads/topic ${ZERO}\n`),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  });
});
