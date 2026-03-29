import { describe, expect, test } from "bun:test";
import { createInstructions } from "./agent-instructions";
import { expectIntent } from "./test-utils";

describe("createInstructions", () => {
  test("includes core instructions", () => {
    const out = createInstructions("Soul.");
    expect(out).toContain("Soul.");
    expectIntent(out, [
      ["current workspace", "requested scope"],
      ["dedicated project tools", "shell only when needed"],
      ["implementation is requested", "persist until", "fully resolved", "end-to-end"],
      ["asks for explanation or planning only", "answer directly"],
      ["surgical", "root-cause", "preserve unrelated content"],
      ["do exactly what was requested"],
      ["compatibility shims"],
      ["avoid redundant", "do not repeat", "unless state changed"],
      ["changing behavior", "create or update related tests"],
      ["expectations/snapshots"],
      ["do not chase unrelated failing tests or bugs"],
      ["concise", "outcome-first"],
      ["reasonable assumptions", "blocked by ambiguity or risk"],
      ["@signal done"],
      ["@signal no_op"],
      ["@signal blocked"],
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
      ["shell-run", "explicit user commands", "known repo commands"],
      ["do not use shell", "file read/search/edit fallbacks"],
    ]);
  });

  test("does not include removed work-layer preamble rules", () => {
    const out = createInstructions("Soul.");
    expect(out).not.toContain("make `file-read` on X your first tool call");
    expect(out).not.toContain("If the user names the files to change");
    expect(out).not.toContain("work one named file at a time");
    expect(out).not.toContain("once every requested file has the requested bounded change, stop");
  });
});
