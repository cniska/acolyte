import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { formatHeaderContextLine, justifyLineSpaceBetween, shownBranch } from "./chat-layout";
import { createTempDir } from "./test-factory";
import { runShellCommand } from "./tools";

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
