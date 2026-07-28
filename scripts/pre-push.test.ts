import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ZERO = "0".repeat(40);
const REPO = process.cwd();

let dir = "";

async function git(args: string[], cwd = dir): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`);
}

async function commit(subject: string, name: string, email: string): Promise<void> {
  await Bun.write(join(dir, `file-${Date.now()}-${Math.random()}.txt`), "x");
  await git(["add", "-A"]);
  await git([
    "-c",
    `user.name=${name}`,
    "-c",
    `user.email=${email}`,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    subject,
    "--no-verify",
  ]);
}

// Pushing a brand-new branch is the case that regressed: the rev-list range is
// multi-token, so quoting it collapsed the loop and every commit went unchecked.
async function runHookOnNewRef(): Promise<{ code: number; stderr: string }> {
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim();
  const proc = Bun.spawn(["bash", ".githooks/pre-push", "origin"], {
    cwd: dir,
    stdin: new TextEncoder().encode(`refs/heads/topic ${head} refs/heads/topic ${ZERO}\n`),
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
  await cp(join(REPO, ".githooks/pre-push"), join(dir, ".githooks/pre-push"));
  for (const script of ["check-commit-message.sh", "check-commit-author.sh"]) {
    await cp(join(REPO, "scripts", script), join(dir, "scripts", script));
  }
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pre-push hook", () => {
  test("rejects a placeholder author on a new branch", async () => {
    await commit("feat: add a thing", "Test User", "test@example.com");
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("reserved placeholder domain");
  });

  test("rejects a malformed subject on a new branch", async () => {
    await commit("no conventional prefix", "Real Name", "real@example.dev");
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("Conventional Commit format");
  });

  test("reports the offending commit id", async () => {
    await commit("feat: add a thing", "Test User", "test@example.com");
    const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim();
    const { stderr } = await runHookOnNewRef();
    expect(stderr).toContain(head);
  });

  test("checks every commit, not only the tip", async () => {
    await commit("feat: first", "Test User", "test@example.com");
    await commit("feat: second", "Real Name", "real@example.dev");
    const { code, stderr } = await runHookOnNewRef();
    expect(code).toBe(1);
    expect(stderr).toContain("reserved placeholder domain");
  });

  test("skips a deleted ref", async () => {
    await commit("feat: add a thing", "Test User", "test@example.com");
    const proc = Bun.spawn(["bash", ".githooks/pre-push", "origin"], {
      cwd: dir,
      stdin: new TextEncoder().encode(`(delete) ${ZERO} refs/heads/topic ${ZERO}\n`),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).not.toContain("reserved placeholder domain");
  });
});
