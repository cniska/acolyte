import { describe, expect, test } from "bun:test";
import { createInstructions } from "./agent-instructions";
import { expectIntent } from "./test-utils";

describe("createInstructions", () => {
  test("includes core instructions", () => {
    const out = createInstructions("Soul.");
    expect(out).toContain("Soul.");
    expectIntent(out, [
      ["this workspace", "this scope"],
      ["dedicated project tools", "shell only when it helps"],
      ["implementation intent is clear", "stay with it", "task is complete"],
      ["asks for explanation or planning only", "answer directly"],
      ["smallest", "root-cause", "matches local conventions"],
      ["unrelated or speculative detours"],
      ["changing behavior", "run related validation first"],
      ["validation is blocked or unavailable", "skipped", "why"],
      ["flowing prose", "leading with the outcome"],
      ["match the shape to the task", "direct answer"],
      ["Keep reasoning, structure, and how things connect in prose", "even when it names many files"],
      ["Use a list only", "short, flat set", "nothing to explain between them"],
      ["Before your first tool call", "briefly state what you are about to do", "short updates at key moments"],
      ["reasonable assumptions", "ambiguity or risk truly blocks progress"],
      ["Search and read files immediately", "never ask"],
      ["references something you cannot see", "session-search"],
    ]);
  });

  test("includes tool and runtime instructions", () => {
    const out = createInstructions("Soul.");
    expectIntent(out, [
      ["code-scan", "ast pattern"],
      ["code-edit", "ast-aware refactors", "file-edit", "plain text edits"],
      ["target", "local", "member"],
      ["withinSymbol"],
      ["refine scope/rule", "current file evidence"],
      ["latest direct", "file-read"],
      ["batch same-file edits"],
      ["diff preview", "bounded changes", "stop"],
      ["file-create", "full content"],
      ["file-find", "name/path pattern"],
      ["file-search", "text/regex"],
      ["shell-run", "user explicitly asked", "known repository commands"],
      ["do not use it for file read/search/edit fallbacks"],
    ]);
  });

  test("appends project rules as a separate prompt block", () => {
    const out = createInstructions("Soul.", undefined, "Project rules.");
    expect(out).toContain("Project rules take precedence over generic guidance when they conflict.");
    expect(out).toContain("Project rules.");
    expect(out.indexOf("Project rules.")).toBeGreaterThan(
      out.indexOf("Project rules take precedence over generic guidance when they conflict."),
    );
  });

  test("does not include removed work-layer preamble rules", () => {
    const out = createInstructions("Soul.");
    expect(out).not.toContain("make `file-read` on X your first tool call");
    expect(out).not.toContain("If the user names the files to change");
    expect(out).not.toContain("work one named file at a time");
    expect(out).not.toContain("once every requested file has the requested bounded change, stop");
  });

  test("does not duplicate soul or toolkit guidance in core bullets", () => {
    const out = createInstructions("Soul.");
    expect(out).not.toContain("Avoid repeating tool calls");
    expect(out).not.toContain("do not forget it");
    expect(out).not.toContain("load one when its use matches the task");
    expect(out).not.toContain("Being understood on first read beats being short");
    expect(out).not.toContain("Questions about the codebase are answered by reading it");
    expect(out).not.toContain("just to double-check the result");
  });

  test("does not claim skills auto-activate", () => {
    const out = createInstructions("Soul.");
    expect(out).not.toContain("activated automatically");
    expect(out).not.toContain("auto-activation");
  });
});
