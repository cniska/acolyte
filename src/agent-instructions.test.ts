import { describe, expect, test } from "bun:test";
import { createInstructions, createModeInstructions } from "./agent-instructions";

describe("createModeInstructions", () => {
  test("work mode includes tool instructions from tool definitions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("code-scan");
    expect(out).toContain("code-edit");
    expect(out).toContain("file-edit");
    expect(out).toContain("file-create");
    expect(out).toContain("shell-run");
  });

  test("work mode includes discovery tool instructions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("Use `file-find` to locate");
    expect(out).toContain("Use `file-search` to search");
    expect(out).toContain("do not use `file-search`; read the file once and make one consolidated `file-edit` call");
    expect(out).toContain("run one scoped `file-search` on that file before `file-edit`");
    expect(out).toContain("do not invent old lines that are not present");
  });

  test("includes preamble lines", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("make `file-read` on X your first tool call");
    expect(out).toContain("If the user names the files to change");
    expect(out).toContain("work one named file at a time");
    expect(out).toContain("once every requested file has the requested bounded change, stop");
    expect(out).toContain("read fails with ENOENT, stop and report");
    expect(out).toContain("stay inside the named files");
    expect(out).toContain("use the exact line already visible in `file-read` output as your edit anchor");
    expect(out).toContain("Every `file-edit` find snippet must come directly from the current `file-read` output");
    expect(out).toContain("preserve the relative or absolute form already used in that file");
    expect(out).toContain("keep the change as small as the request allows");
    expect(out).toContain("repeated literal replacements in one known file");
    expect(out).toContain("collect every visible requested occurrence");
    expect(out).toContain("must cover all of those visible locations");
    expect(out).toContain("if a named file has separated occurrences you have not yet pinned to exact snippets");
    expect(out).toContain("do not signal completion after the first hit or first partial batch");
    expect(out).toContain("make the requested change and stop");
    expect(out).toContain("trust the edit preview and the text you already have");
    expect(out).toContain("do not review, find, search, or scan that same file again in work mode");
    expect(out).toContain("Do not call another write tool on the same named file after a successful bounded edit");
    expect(out).toContain("prefer `code-scan` + `code-edit`");
    expect(out).toContain("`withinSymbol` naming that enclosing symbol");
    expect(out).toContain("symbol-aware within that scope");
    expect(out).toContain('target: "local"');
    expect(out).toContain("do not search for that symbol first");
    expect(out).toContain('{ op: "rename", from: "result", to: "patternResult"');
    expect(out).toContain('{ op: "rename", from: "result", to: "matchResult", withinSymbol: "scanFile" }');
    expect(out).toContain('{ op: "replace", rule: { all: [{ kind: "call_expression" }');
    expect(out).toContain("repeated plain-text rewrite inside one known file");
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
    expect(out).toContain("Preserve unrelated content and surrounding structure");
    expect(out).toContain("Do exactly the requested change");
    expect(out).toContain("Preserve local conventions in the file you are editing");
    expect(out).toContain("keep the file's local relative/absolute reference style");
    expect(out).toContain("@signal done");
    expect(out).toContain("@signal no_op");
    expect(out).toContain("@signal blocked");
  });

  test("work mode includes work-specific instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("code-edit");
    expect(out).toContain("AST");
    expect(out).toContain("Prefer explicit operation objects");
    expect(out).toContain("Scoped rename follows the symbol kind inside the named scope");
    expect(out).toContain("set `target` explicitly to `local` or `member`");
    expect(out).toContain("not for plain text replacements or post-edit reassurance on a bounded named-file task");
    expect(out).toContain("prefer `withinSymbol` with the enclosing name");
    expect(out).toContain("refine the rename scope or rule");
    expect(out).toContain('{ op: "rename", from: "result", to: "patternResult"');
    expect(out).toContain('withinSymbol: "scanFile"');
    expect(out).toContain('{ op: "replace", rule: { all: [{ kind: "call_expression" }');
    expect(out).toContain("broadening the rewrite to unrelated matches");
    expect(out).toContain("calling another write tool on that same file");
    expect(out).toContain("If that preview shows the requested bounded change, stop");
    expect(out).toContain("stop instead of re-reading, searching, reviewing, or editing that same file again");
    expect(out).toContain("use several small exact edits in one call rather than one oversized `find` block");
    expect(out).toContain("collect all visible requested occurrences into the same `file-edit` call");
    expect(out).toContain("include every visible location in that one call");
    expect(out).toContain("Completion means no requested matches remain in that file");
    expect(out).toContain("do not run commands after the edit just to double-check the result");
    expect(out).toContain("call `file-create` with full content");
  });
});
