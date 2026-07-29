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
      ["Before your first action", "what you are about to do"],
      ["load-bearing", "as you find it", "not only in the final answer"],
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

  test("hoists the tool handoffs", () => {
    const out = createInstructions("Soul.");
    expectIntent(out, [
      ["`code-scan` before `code-edit`"],
      ["re-read a file with `file-read` immediately before editing"],
      ["`tasklist-create` once", "then `tasklist-update`"],
    ]);
  });

  // A tool that only describes itself belongs in its own description, next to its schema.
  // These lines were in the prompt for every turn; each one's absence is the contract.
  test("does not restate what a tool's own description says", () => {
    const out = createInstructions("Soul.");
    for (const restatement of [
      "to locate files by name/path pattern",
      "for text/regex content search",
      "with full content directly",
      "to remove a file",
      "when repo-wide state matters",
      "for committed history",
      "to stage edited files before commit",
      "only when the user explicitly asks",
      "to check PR status",
      "check for duplicates",
      "for external information",
      "to read specific URLs",
      "for AST-aware refactors",
      "do not chase unrelated failures",
      "to validate touched behavior",
      "to discover recent undo checkpoints",
      "so cache invalidation",
    ]) {
      expect(out).not.toContain(restatement);
    }
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
