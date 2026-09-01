import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliOutcome } from "./int-test-utils";
import { gitEnv } from "./test-utils";

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn({ cmd: ["git", ...args], cwd, env: gitEnv(), stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

async function withWorkspace<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(join(tmpdir(), "acolyte-cli-tool-"));
  try {
    return await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

describe("acolyte tool", () => {
  test("prints the tool's output rather than the result envelope", async () => {
    await withWorkspace(async (workspace) => {
      await writeFile(join(workspace, "hello.ts"), "export const greeting = 1;\n");
      const { code, stdout } = await runCliOutcome(["tool", "file-read", '{"path":"hello.ts"}'], { cwd: workspace });
      expect(code).toBe(0);
      expect(stdout).toContain("export const greeting = 1;");
      expect(stdout).not.toContain('"result"');
    });
  });

  test("runs a tool that takes no input when given no argument", async () => {
    await withWorkspace(async (workspace) => {
      await git(["init"], workspace);
      await writeFile(join(workspace, "tracked.ts"), "export const a = 1;\n");
      const { code, stdout } = await runCliOutcome(["tool", "git-status"], { cwd: workspace, env: gitEnv() });
      expect(code).toBe(0);
      expect(stdout).toContain("tracked.ts");
      expect(stdout).not.toContain('"result"');
    });
  });

  test("unknown tool names the id and lists the available tools", async () => {
    await withWorkspace(async (workspace) => {
      const { code, stdout, stderr } = await runCliOutcome(["tool", "file-reed"], { cwd: workspace });
      expect(code).toBe(1);
      expect(stderr).toContain("file-reed");
      expect(stderr).toContain("file-read");
      expect(stdout).toBe("");
    });
  });

  test("schema violation prints a readable validation error", async () => {
    await withWorkspace(async (workspace) => {
      const { code, stdout, stderr } = await runCliOutcome(["tool", "file-read", "{}"], { cwd: workspace });
      expect(code).toBe(1);
      expect(stderr).toContain("Invalid input for file-read:");
      expect(stderr).toContain("path");
      expect(stderr.startsWith("[")).toBe(false);
      expect(stdout).toBe("");
    });
  });

  test("a write outside the workspace boundary is refused and performs no I/O", async () => {
    await withWorkspace(async (workspace) => {
      const outside = join(workspace, "..", `escaped-${process.pid}.txt`);
      const { code, stderr } = await runCliOutcome(
        ["tool", "file-create", JSON.stringify({ path: outside, content: "escaped" })],
        { cwd: workspace },
      );
      expect(code).toBe(1);
      expect(stderr).toContain("Sandbox violation");
      expect(existsSync(outside)).toBe(false);
    });
  });
});
