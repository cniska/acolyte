import { describe, expect, test } from "bun:test";
import { createInstructions, createModeInstructions } from "./agent-instructions";

describe("createModeInstructions", () => {
  test("work mode includes tool instructions from tool definitions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("scan-code");
    expect(out).toContain("edit-code");
    expect(out).toContain("edit-file");
    expect(out).toContain("create-file");
    expect(out).toContain("run-command");
  });

  test("work mode includes discovery tool instructions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("Use `find-files` to locate");
    expect(out).toContain("Use `search-files` to search");
  });

  test("includes preamble lines", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("Read the target file once");
    expect(out).toContain("make `read-file` on X your first tool call");
    expect(out).toContain("If the user names the files to change");
    expect(out).toContain("do not batch the initial `read-file` across named targets");
    expect(out).toContain("read fails with ENOENT, stop and report");
    expect(out).toContain("do not inspect neighboring files for examples or style");
    expect(out).toContain("do not use repo-wide `search-files`");
    expect(out).toContain("do not use `git-status` or `git-diff` just to rediscover");
    expect(out).toContain("use the exact line already visible in `read-file` output as your edit anchor");
    expect(out).toContain("do not call `search-files` just to locate it again");
    expect(out).toContain("prefer `scan-code` + `edit-code`");
    expect(out).toContain("Trust type signatures");
  });

  test("verify mode includes verification instructions", () => {
    const out = createModeInstructions("verify");
    expect(out).toContain("Review the changes");
    expect(out).toContain("Choose the lightest sufficient verification");
    expect(out).toContain("Report any issues found");
    expect(out).toContain("Do not fix them");
  });

  test("work mode does not include verification instructions", () => {
    const out = createModeInstructions("work");
    expect(out).not.toContain("Review the changes");
  });
});

describe("createInstructions", () => {
  test("includes base instructions for all modes", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("Soul.");
    expect(out).toContain("Prefer dedicated project tools; use shell only when no dedicated tool exists.");
    expect(out).toContain("Before taking action (tool call, command, or edit), write exactly one sentence");
    expect(out).toContain("Keep tool calls and file changes within the current workspace and the requested scope.");
    expect(out).toContain("preserve unrelated content and surrounding structure");
    expect(out).toContain("Preserve local conventions in the file you are editing");
  });

  test("work mode includes work-specific instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("edit-code");
    expect(out).toContain("AST");
    expect(out).toContain("Read the target file once");
    expect(out).toContain("call `create-file` with full content");
  });
});
