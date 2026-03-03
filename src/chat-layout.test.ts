import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { formatHeaderContextLine, justifyLineSpaceBetween, shownBranch } from "./chat-layout";
import { createTempDir } from "./test-utils";

async function runGit(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr || stdout}`);
}

function withColumns(width: number, task: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
  try {
    task();
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
    else delete (process.stdout as { columns?: number }).columns;
  }
}

describe("chat-layout", () => {
  test("formatHeaderContextLine composes workspace, branch, and model", () => {
    expect(formatHeaderContextLine("~/code/acolyte", "main", "gpt-5-mini")).toBe("~/code/acolyte · main · gpt-5-mini");
    expect(formatHeaderContextLine("~/code/acolyte", null, "gpt-5-mini")).toBe("~/code/acolyte · — · gpt-5-mini");
  });

  test("shownBranch returns null outside git repositories", async () => {
    const workspace = await createTempDir("acolyte-chat-layout-");
    try {
      expect(await shownBranch(workspace)).toBeNull();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shownBranch returns a branch name inside a git repository", async () => {
    const workspace = await createTempDir("acolyte-chat-layout-");
    try {
      await runGit(workspace, "init");
      await runGit(workspace, "config", "user.email", "test@example.com");
      await runGit(workspace, "config", "user.name", "Test");
      await Bun.write(`${workspace}/README.md`, "seed\n");
      await runGit(workspace, "add", "README.md");
      await runGit(workspace, "commit", "-m", "init");
      const branch = await shownBranch(workspace);
      expect(branch).not.toBeNull();
      expect(branch?.trim().length ?? 0).toBeGreaterThan(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("justifyLineSpaceBetween keeps help left and context right", () => {
    withColumns(40, () => {
      expect(justifyLineSpaceBetween("? help", "acolyte · main · gpt-5-mini")).toBe(
        "? help       acolyte · main · gpt-5-mini",
      );
    });
  });

  test("justifyLineSpaceBetween falls back when line is too narrow", () => {
    withColumns(10, () => {
      expect(justifyLineSpaceBetween("? help", "acolyte · main · gpt-5-mini")).toBe(
        "? help · acolyte · main · gpt-5-mini",
      );
    });
  });
});
