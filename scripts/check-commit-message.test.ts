import { describe, expect, test } from "bun:test";

const SCRIPT = "scripts/check-commit-message.sh";

async function check(subject: string, body?: string): Promise<{ code: number; stderr: string }> {
  const args = body === undefined ? [subject] : [subject, body];
  const proc = Bun.spawn(["bash", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  return { code: await proc.exited, stderr };
}

describe("check-commit-message", () => {
  test.each([
    ["feat: add a thing"],
    ["fix: correct a thing"],
    ["refactor: reshape a thing"],
    ["docs: describe a thing"],
    ["test: cover a thing"],
    ["chore: tidy a thing"],
    ["feat(memory): add a thing"],
    ["fix(tui-render): correct a thing"],
    ["feat!: breaking change"],
    ["feat(memory)!: breaking change"],
  ])("accepts %s", async (subject) => {
    const { code } = await check(subject);
    expect(code).toBe(0);
  });

  test.each([
    ["missing type", "add a thing"],
    ["unknown type", "feature: add a thing"],
    ["no description", "feat:"],
    ["uppercase scope", "feat(Memory): add a thing"],
    ["capitalized type", "Feat: add a thing"],
  ])("rejects %s", async (_label, subject) => {
    const { code, stderr } = await check(subject);
    expect(code).toBe(1);
    expect(stderr).toContain("Conventional Commit format");
  });

  test("rejects a commit with a body", async () => {
    const { code, stderr } = await check("feat: add a thing", "an explanatory body");
    expect(code).toBe(1);
    expect(stderr).toContain("commit has a body");
  });

  test("accepts an empty body argument", async () => {
    const { code } = await check("feat: add a thing", "");
    expect(code).toBe(0);
  });

  test("accepts a subject of exactly 72 characters", async () => {
    const subject = `feat: ${"a".repeat(66)}`;
    expect(subject).toHaveLength(72);
    const { code } = await check(subject);
    expect(code).toBe(0);
  });

  test("rejects a subject over 72 characters", async () => {
    const subject = `feat: ${"a".repeat(67)}`;
    expect(subject).toHaveLength(73);
    const { code, stderr } = await check(subject);
    expect(code).toBe(1);
    expect(stderr).toContain("exceeds 72 characters");
  });

  test("rejects non-ASCII characters", async () => {
    const { code, stderr } = await check("feat: add an em—dash");
    expect(code).toBe(1);
    expect(stderr).toContain("non-ASCII");
  });

  test("exits 2 without a subject", async () => {
    const { code, stderr } = await check("");
    expect(code).toBe(2);
    expect(stderr).toContain("usage:");
  });
});
