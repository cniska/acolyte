import { describe, expect, test } from "bun:test";
import { expectIntent } from "./test-utils";
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

  test("tool instructions encode behavioral intent by tool type", () => {
    const readInstruction = toolDefinitionsById["file-read"]?.instruction ?? "";
    const editInstruction = toolDefinitionsById["file-edit"]?.instruction ?? "";
    const editCodeInstruction = toolDefinitionsById["code-edit"]?.instruction ?? "";
    const searchInstruction = toolDefinitionsById["file-search"]?.instruction ?? "";
    const findInstruction = toolDefinitionsById["file-find"]?.instruction ?? "";
    const createInstruction = toolDefinitionsById["file-create"]?.instruction ?? "";
    const deleteInstruction = toolDefinitionsById["file-delete"]?.instruction ?? "";
    const gitStatusInstruction = toolDefinitionsById["git-status"]?.instruction ?? "";
    const gitDiffInstruction = toolDefinitionsById["git-diff"]?.instruction ?? "";
    const gitLogInstruction = toolDefinitionsById["git-log"]?.instruction ?? "";
    const gitShowInstruction = toolDefinitionsById["git-show"]?.instruction ?? "";
    const runCommandInstruction = toolDefinitionsById["shell-run"]?.instruction ?? "";
    const runTestsInstruction = toolDefinitionsById["test-run"]?.instruction ?? "";
    const webSearchInstruction = toolDefinitionsById["web-search"]?.instruction ?? "";
    const webFetchInstruction = toolDefinitionsById["web-fetch"]?.instruction ?? "";
    const checklistCreateInstruction = toolDefinitionsById["checklist-create"]?.instruction ?? "";
    const checklistUpdateInstruction = toolDefinitionsById["checklist-update"]?.instruction ?? "";

    expectIntent(readInstruction, [
      ["file-read", "before", "file-edit", "code-edit"],
      ["re-read", "target file", "before editing"],
    ]);
    expectIntent(findInstruction, [["file-find", "locate files"], ["patterns", "array"], ["batch"]]);
    expectIntent(createInstruction, [["file-create", "full content"]]);
    expectIntent(deleteInstruction, [["file-delete"], ["paths", "array"], ["batch"]]);
    expectIntent(editInstruction, [
      ["latest direct", "file-read"],
      ["batch same-file edits"],
      ["diff preview", "bounded changes", "stop"],
      ["code-edit", "structural", "refactors"],
    ]);
    expectIntent(editCodeInstruction, [["ast-aware refactors"], ["target", "local", "member"], ["withinsymbol"]]);
    expectIntent(searchInstruction, [["text/regex"], ["narrow scope", "paths"], ["edit from that evidence"]]);
    expectIntent(gitStatusInstruction, [["repo-wide state"], ["file-scoped edits"]]);
    expectIntent(gitDiffInstruction, [["git-level diff context"], ["write-tool previews"]]);
    expectIntent(gitLogInstruction, [["committed history"], ["uncommitted edits"]]);
    expectIntent(gitShowInstruction, [["committed history"], ["uncommitted edits"]]);
    expectIntent(runCommandInstruction, [
      ["explicit user commands"],
      ["known repo commands"],
      ["do not use shell", "fallbacks"],
    ]);
    expectIntent(runTestsInstruction, [
      ["validate touched behavior"],
      ["create or update related tests"],
      ["narrowest related tests"],
      ["widen scope", "user asks"],
      ["do not chase unrelated failures"],
    ]);
    expectIntent(webSearchInstruction, [["external information"], ["not available in the repository"]]);
    expectIntent(webFetchInstruction, [["read specific urls"]]);
    expectIntent(checklistCreateInstruction, [["checklist-create"], ["multi-step tasks"], ["checklist-update"]]);
    expectIntent(checklistUpdateInstruction, [["checklist-update"], ["status"], ["checklist-create"]]);
  });
});
