import { describe, expect, test } from "bun:test";

const SCRIPT = "scripts/check-commit-author.sh";

async function check(name: string, email: string): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, name, email], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  return { code: await proc.exited, stderr };
}

describe("check-commit-author", () => {
  test("accepts a real identity", async () => {
    const { code } = await check("Christoffer Niska", "christofferniska@gmail.com");
    expect(code).toBe(0);
  });

  test("accepts subdomains and tagged addresses", async () => {
    const { code } = await check("A B", "a.b+tag@mail.domain.co.uk");
    expect(code).toBe(0);
  });

  test.each([
    ["test@example.com"],
    ["TEST@Example.COM"],
    ["u@example.net"],
    ["u@example.org"],
    ["u@mail.example.com"],
    ["u@host.invalid"],
    ["u@foo.test"],
    ["u@thing.example"],
    ["root@localhost"],
  ])("rejects placeholder domain %s", async (email) => {
    const { code, stderr } = await check("Test User", email);
    expect(code).toBe(1);
    expect(stderr).toContain("reserved placeholder domain");
  });

  test("rejects an empty name", async () => {
    const { code, stderr } = await check("", "a@b.com");
    expect(code).toBe(1);
    expect(stderr).toContain("name is empty");
  });

  test("rejects an empty email", async () => {
    const { code, stderr } = await check("A B", "");
    expect(code).toBe(1);
    expect(stderr).toContain("email is empty");
  });

  test("rejects a malformed email", async () => {
    const { code, stderr } = await check("A B", "not-an-email");
    expect(code).toBe(1);
    expect(stderr).toContain("not a valid address");
  });

  test("reports the role in the message", async () => {
    const proc = Bun.spawn(["bash", SCRIPT, "Test User", "test@example.com", "committer"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(1);
    expect(stderr).toContain("commit committer email");
  });
});
