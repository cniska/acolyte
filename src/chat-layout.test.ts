import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { formatHeaderContextLine, shownBranch } from "./chat-layout";
import { createTempDir } from "./test-factory";
import { runShellCommand } from "./tools";

describe("chat-layout", () => {
  test("formatHeaderContextLine composes workspace, branch, and model", () => {
    expect(formatHeaderContextLine("~/code/acolyte", "main", "gpt-5-mini")).toBe(
      "~/code/acolyte · main · gpt-5-mini",
    );
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

  test("shownBranch returns current branch inside a git repository", async () => {
    const workspace = await createTempDir("acolyte-chat-layout-");
    try {
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      expect(await shownBranch(workspace)).toBe("main");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
