import { describe, expect, test } from "bun:test";
import { renderToolOutputPart } from "./tool-output-content";
import { toolDefinitionsById, toolIds, toolIdsByCategory, toolsForAgent } from "./tool-registry";

describe("toolsets", () => {
  test("returns all tools", () => {
    const { tools, session } = toolsForAgent();
    expect(Object.keys(tools).sort()).toEqual([
      "createChecklist",
      "createFile",
      "deleteFile",
      "editCode",
      "editFile",
      "findFiles",
      "gitAdd",
      "gitCommit",
      "gitDiff",
      "gitLog",
      "gitShow",
      "gitStatus",
      "readFile",
      "runCommand",
      "runTests",
      "scanCode",
      "searchFiles",
      "updateChecklist",
      "webFetch",
      "webSearch",
    ]);
    expect(session).toBeDefined();
    expect(session.callLog).toEqual([]);
  });
});

describe("toolIds", () => {
  test("returns all registered tool ids in sorted order", () => {
    const ids = toolIds();
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("file-read");
    expect(ids).toContain("file-edit");
    expect(ids).toContain("shell-run");
    expect(ids).toContain("web-search");
    expect(ids).toContain("git-add");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("toolIdsByCategory", () => {
  test("write category returns write tools only", () => {
    const ids = toolIdsByCategory("write");
    expect(ids).toContain("file-edit");
    expect(ids).toContain("code-edit");
    expect(ids).toContain("file-create");
    expect(ids).toContain("file-delete");
    expect(ids).toContain("git-add");
    expect(ids).toContain("git-commit");
    expect(ids).not.toContain("checklist-update");
    expect(ids).not.toContain("file-read");
    expect(ids).not.toContain("shell-run");
    expect(ids).not.toContain("web-search");
  });
});

describe("localization baseline", () => {
  test("tool ids stay language-neutral", () => {
    const toolNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
    for (const name of Object.keys(toolDefinitionsById)) {
      expect(name).toMatch(toolNamePattern);
    }
  });

  test("tool output content renders marker tokens", () => {
    expect(renderToolOutputPart({ kind: "truncated", count: 3, unit: "lines" })).toBe("… +3 lines");
    expect(renderToolOutputPart({ kind: "truncated", count: 1, unit: "lines" })).toBe("… +1 line");
    expect(renderToolOutputPart({ kind: "truncated", count: 5, unit: "matches" })).toBe("… +5 matches");
    expect(renderToolOutputPart({ kind: "truncated", count: 1, unit: "matches" })).toBe("… +1 match");
    expect(renderToolOutputPart({ kind: "no-output" })).toBe("(No output)");
  });

  test("file tool instructions prefer direct reads before editing a chosen file", () => {
    const readInstruction = toolDefinitionsById["file-read"]?.instruction ?? "";
    const editInstruction = toolDefinitionsById["file-edit"]?.instruction ?? "";
    const editCodeInstruction = toolDefinitionsById["code-edit"]?.instruction ?? "";
    const searchInstruction = toolDefinitionsById["file-search"]?.instruction ?? "";
    const gitStatusInstruction = toolDefinitionsById["git-status"]?.instruction ?? "";
    const gitDiffInstruction = toolDefinitionsById["git-diff"]?.instruction ?? "";
    const gitLogInstruction = toolDefinitionsById["git-log"]?.instruction ?? "";
    const gitShowInstruction = toolDefinitionsById["git-show"]?.instruction ?? "";
    const runCommandInstruction = toolDefinitionsById["shell-run"]?.instruction ?? "";

    expect(readInstruction).toContain("Use `file-read` before editing.");
    expect(readInstruction).toContain("when editing named files, read the file right before");
    expect(editInstruction).toContain("latest direct `file-read` of that file");
    expect(editInstruction).toContain("Batch multiple edits to the same file");
    expect(editInstruction).toContain("Use `code-edit` only for structural AST-aware refactors");
    expect(editCodeInstruction).toContain("Use `code-edit` for AST-aware refactors and structural rewrites.");
    expect(editCodeInstruction).toContain("set `target` explicitly to `local` or `member`");
    expect(searchInstruction).toContain("narrow scope with `paths`");
    expect(searchInstruction).toContain("edit from that evidence");
    expect(searchInstruction).toContain(
      "use `find` snippets from current `file-read` text or scoped `file-search` hits only",
    );
    expect(gitStatusInstruction).toContain("repository-wide state matters");
    expect(gitStatusInstruction).toContain("already understood file-scoped task");
    expect(gitDiffInstruction).toContain("repository diff context matters");
    expect(gitDiffInstruction).toContain("trust write-tool previews");
    expect(gitLogInstruction).toContain("for history, not current uncommitted edits");
    expect(gitShowInstruction).toContain("for history, not current uncommitted edits");
    expect(runCommandInstruction).toContain("Use `shell-run` for known repository commands");
    expect(runCommandInstruction).toContain("Do not use shell for file read/search/edit fallbacks");
  });
});
