import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createGitFixture, type GitFixture, PLACEHOLDER_IDENTITY, REAL_IDENTITY } from "./git-fixture";

let fixture: GitFixture;

async function check(...range: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["bash", "scripts/check-commits.sh", ...(range.length ? range : ["HEAD"])], {
    cwd: fixture.dir,
    env: fixture.env(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  return { code: await proc.exited, stderr };
}

beforeEach(async () => {
  fixture = await createGitFixture({ prefix: "acolyte-check-commits-" });
});

afterEach(() => fixture.cleanup());

describe("check-commits.sh", () => {
  test("accepts a valid commit", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY);
    expect((await check()).code).toBe(0);
  });

  test("accepts an empty range", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY);
    expect((await check("HEAD..HEAD")).code).toBe(0);
  });

  test("rejects a malformed subject", async () => {
    await fixture.commit("added a thing", REAL_IDENTITY);
    const { code, stderr } = await check();
    expect(code).toBe(1);
    expect(stderr).toContain("Conventional Commit format");
  });

  test("rejects a placeholder author", async () => {
    await fixture.commit("feat: add a thing", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    const { code, stderr } = await check();
    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("rejects a placeholder author with repeated whitespace", async () => {
    await fixture.commit("feat: add a thing", { name: "Your  Name", email: "real@example.dev" }, REAL_IDENTITY);
    const { code, stderr } = await check();
    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("rejects a placeholder committer", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY, PLACEHOLDER_IDENTITY);
    const { code, stderr } = await check();
    expect(code).toBe(1);
    expect(stderr).toContain("committer name is a placeholder");
  });

  test("rejects a placeholder author email", async () => {
    await fixture.commit("feat: add a thing", { name: "Real Name", email: "test@example.com" }, REAL_IDENTITY);
    const { code, stderr } = await check();
    expect(code).toBe(1);
    expect(stderr).toContain("author email uses a reserved placeholder domain");
  });

  test("rejects a placeholder committer email", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY, { name: "Real Name", email: "test@example.com" });
    const { code, stderr } = await check();
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
    ["real@xn--a.com", "not a valid address"],
  ])("rejects invalid author email %s", async (email, message) => {
    await fixture.commit("feat: add a thing", { name: "Real Name", email }, REAL_IDENTITY);
    const { code, stderr } = await check();
    expect(code).toBe(1);
    expect(stderr).toContain(message);
  });

  test("reports the offending commit id", async () => {
    await fixture.commit("feat: add a thing", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    const head = fixture.gitOutput(["rev-parse", "HEAD"]);
    expect((await check()).stderr).toContain(head);
  });

  test("reports a commit once even when several checks fail", async () => {
    await fixture.commit("added a thing", PLACEHOLDER_IDENTITY, PLACEHOLDER_IDENTITY);
    const head = fixture.gitOutput(["rev-parse", "HEAD"]);
    const { stderr } = await check();
    expect(stderr.split(`  commit: ${head}`).length - 1).toBe(1);
  });

  test("checks every commit, not only the tip", async () => {
    await fixture.commit("feat: first", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    await fixture.commit("feat: second", REAL_IDENTITY);
    const { code, stderr } = await check();
    expect(code).toBe(1);
    expect(stderr).toContain("author name is a placeholder");
  });

  test("reports every offending commit rather than stopping at the first", async () => {
    await fixture.commit("feat: first", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    const first = fixture.gitOutput(["rev-parse", "HEAD"]);
    await fixture.commit("feat: second", { name: "Real Name", email: "second@example.com" }, REAL_IDENTITY);
    const second = fixture.gitOutput(["rev-parse", "HEAD"]);

    const { code, stderr } = await check();

    expect(code).toBe(1);
    expect(stderr).toContain(first);
    expect(stderr).toContain(second);
  });

  test("honours an exclusion range", async () => {
    await fixture.commit("feat: remote", PLACEHOLDER_IDENTITY, REAL_IDENTITY);
    const remoteTip = fixture.gitOutput(["rev-parse", "HEAD"]);
    await fixture.commit("feat: branch", REAL_IDENTITY);

    expect((await check(`${remoteTip}..HEAD`)).code).toBe(0);
  });

  test("fails closed when the range cannot be enumerated", async () => {
    await fixture.commit("feat: add a thing", REAL_IDENTITY);
    const { code, stderr } = await check(`${"1".repeat(40)}..HEAD`);
    expect(code).toBe(1);
    expect(stderr).toContain("cannot enumerate commits");
  });
});
