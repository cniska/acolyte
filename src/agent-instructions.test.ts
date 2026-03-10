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

  test("plan mode includes tool instructions from tool definitions", () => {
    const out = createModeInstructions("plan");
    expect(out).toContain("find-files");
    expect(out).toContain("search-files");
    expect(out).toContain("read-file");
  });

  test("work mode includes discovery tool instructions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("Use `find-files` to locate");
    expect(out).toContain("Use `search-files` to search");
  });

  test("includes preamble lines", () => {
    const code = createModeInstructions("work");
    const explore = createModeInstructions("plan");
    expect(code).toContain("Read the target file once");
    expect(code).toContain("make `read-file` on X your first tool call");
    expect(code).toContain("read fails with ENOENT, stop and report");
    expect(code).toContain("prefer `scan-code` + `edit-code`");
    expect(code).toContain("Trust type signatures");
    expect(explore).toContain("negative-answer tasks");
    expect(explore).toContain("Search first");
  });

  test("verify mode includes verification instructions", () => {
    const out = createModeInstructions("verify");
    expect(out).toContain("Review the changes");
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
    const code = createInstructions("Soul.", "work");
    const explore = createInstructions("Soul.", "plan");
    for (const out of [code, explore]) {
      expect(out).toContain("Soul.");
      expect(out).toContain("Prefer dedicated project tools; use shell only when no dedicated tool exists.");
      expect(out).toContain("Before taking action (tool call, command, or edit), write exactly one sentence");
      expect(out).toContain("Keep tool calls and file changes within the current workspace and the requested scope.");
    }
  });

  test("work mode includes work-specific instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("edit-code");
    expect(out).toContain("AST");
    expect(out).toContain("Read the target file once");
    expect(out).toContain("call `create-file` with full content");
  });

  test("work mode excludes plan-only instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).not.toContain("Search first");
  });

  test("plan mode includes plan-specific instructions", () => {
    const out = createInstructions("Soul.", "plan");
    expect(out).toContain("find-files");
    expect(out).toContain("Batch multiple paths");
  });

  test("plan mode excludes work instructions", () => {
    const out = createInstructions("Soul.", "plan");
    expect(out).not.toContain("edit-code` for multi-location");
    expect(out).not.toContain("Read the target file once");
  });
});
