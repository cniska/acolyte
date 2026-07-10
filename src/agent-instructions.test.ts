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
      ["avoid repeating tool calls", "new information"],
      ["changing behavior", "run related validation first"],
      ["validation is blocked or unavailable", "skipped", "why"],
      ["flowing prose", "leading with the outcome"],
      ["Being understood on first read", "match the shape to the task"],
      ["Keep reasoning, structure, and how things connect in prose", "even when it names many files"],
      ["Use a list only", "short, flat set", "nothing to explain between them"],
      ["Say what you are about to do", "surface findings"],
      ["reasonable assumptions", "ambiguity or risk truly blocks progress"],
      ["Questions about the codebase", "Search and read files immediately", "never ask"],
      ["Available skills are listed each turn", "skill-activate"],
      ["signal_done"],
      ["signal_noop"],
      ["signal_blocked", "cannot obtain", "never for information findable in the workspace"],
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

  test("does not claim skills auto-activate", () => {
    const out = createInstructions("Soul.");
    expect(out).not.toContain("activated automatically");
    expect(out).not.toContain("auto-activation");
  });
});
