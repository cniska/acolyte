import { describe, expect, test } from "bun:test";
import { createInstructions } from "./agent-instructions";
import { expectIntent } from "./test-utils";

describe("createInstructions", () => {
  test("carries the soul and the output contract", () => {
    const out = createInstructions("Soul.");
    expect(out).toContain("Soul.");
    expectIntent(out, [
      ["Format as plain text", "backticks", "no headings or links"],
      ["fenced code block", "never file contents"],
      ["Keep reasoning, structure, and how things connect in prose", "even when it names many files"],
      ["Use a list only", "short, flat set", "nothing to explain between them"],
    ]);
  });

  // How Acolyte works lives in soul.md. Restating it here is what regrew the prompt past
  // its pre-#97 size, so the absence is the contract.
  test("does not restate how Acolyte works", () => {
    const out = createInstructions("Soul.");
    for (const restatement of [
      "this workspace and this scope",
      "dedicated project tools",
      "stay with it until the task",
      "smallest root-cause change",
      "unrelated or speculative detours",
      "run related validation first",
      "Before your first tool call",
      "reasonable assumptions",
      "Search and read files immediately",
      "references something you cannot see",
    ]) {
      expect(out).not.toContain(restatement);
    }
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
      ["shell-run", "repository commands", "the user asked for"],
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

  test("renders active skill bodies verbatim after project rules", () => {
    const out = createInstructions("Soul.", undefined, "Project rules.", [
      { name: "build", instructions: "keep slices small." },
      { name: "tdd", instructions: "red, green, refactor." },
    ]);
    expect(out).toContain("Active skill (build):\nkeep slices small.");
    expect(out).toContain("Active skill (tdd):\nred, green, refactor.");
    // Skill guidance ranks below project rules in precedence, so it renders after them.
    expect(out.indexOf("Active skill (build):")).toBeGreaterThan(out.indexOf("Project rules."));
  });

  test("omits the skills section when no skills are active", () => {
    const out = createInstructions("Soul.");
    expect(out).not.toContain("Active skill (");
  });
});
