import { describe, expect, test } from "bun:test";
import { createInstructions } from "./agent-instructions";

describe("createInstructions", () => {
  test("includes core instructions", () => {
    const out = createInstructions("Soul.");
    expect(out).toContain("Soul.");
    expect(out).toContain("Use dedicated project tools first; use shell only when needed.");
    expect(out).toContain("Before each tool call, command, or edit, write one short next-step sentence");
    expect(out).toContain("Keep tool calls and file changes within the current workspace and the requested scope.");
    expect(out).toContain("Make surgical edits: preserve unrelated content");
    expect(out).toContain("Do exactly what was requested");
    expect(out).toContain("avoid step-by-step recaps");
    expect(out).toContain("@signal done");
    expect(out).toContain("@signal no_op");
    expect(out).toContain("@signal blocked");
  });

  test("includes tool and runtime instructions", () => {
    const out = createInstructions("Soul.");
    expect(out).toContain("Use `code-scan` for AST pattern matching.");
    expect(out).toContain("Use `code-edit` for AST-aware refactors and structural rewrites.");
    expect(out).toContain("Use `file-edit` for plain text edits.");
    expect(out).toContain("set `target` explicitly to `local` or `member`");
    expect(out).toContain("prefer `withinSymbol` with the enclosing name");
    expect(out).toContain("refine scope or rule from current file evidence");
    expect(out).toContain('{ op: "rename", from: "result", to: "patternResult"');
    expect(out).toContain('{ op: "replace", rule: { all: [{ kind: "call_expression" }');
    expect(out).toContain("latest direct `file-read` of that file");
    expect(out).toContain("include all visible requested occurrences in the same call");
    expect(out).toContain("Use the diff preview to confirm bounded changes and stop when done.");
    expect(out).toContain("call `file-create` with full content");
    expect(out).toContain("Use `file-find` to locate");
    expect(out).toContain("Use `file-search` to search");
    expect(out).toContain("Use `shell-run` for known repository commands");
    expect(out).toContain("Do not use shell for file read/search/edit fallbacks");
  });

  test("does not include removed work-layer preamble rules", () => {
    const out = createInstructions("Soul.");
    expect(out).not.toContain("make `file-read` on X your first tool call");
    expect(out).not.toContain("If the user names the files to change");
    expect(out).not.toContain("work one named file at a time");
    expect(out).not.toContain("once every requested file has the requested bounded change, stop");
  });
});
