import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ZERO = "0".repeat(40);
const REPO = process.cwd();

let dir = "";

function hookEnv(useFakeBun = true): Record<string, string> {
  return { ...process.env, PATH: useFakeBun ? `${join(dir, "bin")}:${process.env.PATH}` : process.env.PATH };
}

async function git(args: string[], cwd = dir): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`);
}

type Identity = { name: string; email: string };

async function commit(subject: string, author: Identity, committer = author): Promise<void> {
  await Bun.write(join(dir, `file-${Date.now()}-${Math.random()}.txt`), "x");
  await git(["add", "-A"]);
  await git([
    "-c",
    `user.name=${committer.name}`,
    "-c",
    `user.email=${committer.email}`,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    subject,
    `--author=${author.name} <${author.email}>`,
    "--no-verify",
  ]);
}

// Pushing a brand-new branch is the case that regressed: the rev-list range is
// multi-token, so quoting it collapsed the loop and every commit went unchecked.
async function runHookOnNewRef(
  remoteOid = ZERO,
  useFakeBun = true,
  remote = "origin",
): Promise<{ code: number; stderr: string }> {
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim();
  const proc = Bun.spawn(["bash", ".githooks/pre-push", remote], {
    cwd: dir,
    env: hookEnv(useFakeBun),
    stdin: new TextEncoder().encode(`refs/heads/topic ${head} refs/heads/topic ${remoteOid}\n`),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  return { code: await proc.exited, stderr };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "acolyte-pre-push-"));
  await git(["init", "-q", "-b", "main"]);
  await mkdir(join(dir, ".githooks"));
  await mkdir(join(dir, "scripts"));
  await mkdir(join(dir, "bin"));
  await Bun.write(join(dir, "bin", "bun"), "#!/bin/sh\nexit 0\n");
  await chmod(join(dir, "bin", "bun"), 0o755);
  await cp(join(REPO, ".githooks/pre-push"), join(dir, ".githooks/pre-push"));
  for (const script of ["check-commit-message.sh", "check-commit-author.sh"]) {
    await cp(join(REPO, "scripts", script), join(dir, "scripts", script));
  }
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pre-push hook", () => {
  const realIdentity = { name: "Real Name", email: "real@example.xn--p1ai" };

  test("accepts a valid commit on a new branch", async () => {
    await commit("feat: add a thing", realIdentity);
    const { code } = await runHookOnNewRef();
    expect(code).toBe(0);
  });

  test("rejects a placeholder author on a new branch", async () => {
    await commit("feat: add a thing", { name: "Your Name", email: "real@example.dev" }, realIdentity);
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("rejects a placeholder author with repeated whitespace", async () => {
    await commit("feat: add a thing", { name: "Your  Name", email: "real@example.dev" }, realIdentity);
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("rejects a placeholder committer on a new branch", async () => {
    await commit("feat: add a thing", realIdentity, { name: "Your Name", email: "real@example.dev" });
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("committer name is a placeholder");
  });

  test("rejects a placeholder author email on a new branch", async () => {
    await commit("feat: add a thing", { name: "Real Name", email: "test@example.com" }, realIdentity);
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("author email uses a reserved placeholder domain");
  });

  test("rejects a placeholder committer email on a new branch", async () => {
    await commit("feat: add a thing", realIdentity, { name: "Real Name", email: "test@example.com" });
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("committer email uses a reserved placeholder domain");
  });

  test.each([
    ["TEST@Example.COM", "reserved placeholder domain"],
    ["real@sub.example.org", "reserved placeholder domain"],
    ["real@host.invalid", "reserved placeholder domain"],
    ["real@host.test", "reserved placeholder domain"],
    ["real@host.localhost", "reserved placeholder domain"],
    ["real@example..com", "not a valid address"],
  ])("rejects invalid author email %s", async (email, message) => {
    await commit("feat: add a thing", { name: "Real Name", email }, realIdentity);
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain(message);
  });

  test("rejects malformed punycode author email", async () => {
    await commit("feat: add a thing", { name: "Real Name", email: "real@xn--a.com" }, realIdentity);
    const { code, stderr } = await runHookOnNewRef(ZERO, false);
    expect(code).toBe(1);
    expect(stderr).toContain("author email is not a valid address");
  });

  test("reports the offending commit id", async () => {
    await commit("feat: add a thing", { name: "Your Name", email: "real@example.dev" }, realIdentity);
    const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim();
    const { stderr } = await runHookOnNewRef();
    expect(stderr).toContain(head);
  });

  test("checks every commit, not only the tip", async () => {
    await commit("feat: first", { name: "Your Name", email: "real@example.dev" }, realIdentity);
    await commit("feat: second", realIdentity);
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("excludes commits already on the remote from a new branch", async () => {
    await commit("feat: remote", { name: "Your Name", email: "real@example.dev" }, realIdentity);
    const remoteTip = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim();
    await git(["remote", "add", "origin", "https://example.com/acolyte.git"]);
    await git(["update-ref", "refs/remotes/origin/main", remoteTip]);
    await commit("feat: branch", realIdentity);

    const { code } = await runHookOnNewRef();

    expect(code).toBe(0);
  });

  test("checks remote ancestors on a direct URL push", async () => {
    await commit("feat: remote", { name: "Your Name", email: "real@example.dev" }, realIdentity);
    const remoteTip = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim();
    await git(["update-ref", "refs/remotes/origin/main", remoteTip]);
    await commit("feat: branch", realIdentity);

    const { code, stderr } = await runHookOnNewRef(ZERO, true, "https://example.com/acolyte.git");

    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("fails closed when the remote tip is unavailable locally", async () => {
    await commit("feat: add a thing", realIdentity);

    const { code, stderr } = await runHookOnNewRef("1".repeat(40));

    expect(code).toBe(1);
    expect(stderr).toContain("cannot enumerate commits");
  });

  test("skips a deleted ref", async () => {
    await commit("feat: add a thing", realIdentity);
    const proc = Bun.spawn(["bash", ".githooks/pre-push", "origin"], {
      cwd: dir,
      env: hookEnv(),
      stdin: new TextEncoder().encode(`(delete) ${ZERO} refs/heads/topic ${ZERO}\n`),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  });
});
