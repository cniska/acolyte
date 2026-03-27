import { describe, expect, test } from "bun:test";
import { renderToolOutputPart } from "./tool-output-content";
import {
  hasPermissions,
  toolDefinitionsById,
  toolIdsByCategory,
  toolIdsForGrants,
  toolsForAgent,
} from "./tool-registry";

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

describe("hasPermissions", () => {
  test("returns true when grants satisfy all requirements", () => {
    expect(hasPermissions(["read", "write", "execute"], ["read", "write"])).toBe(true);
    expect(hasPermissions(["read"], ["read"])).toBe(true);
  });

  test("returns false when grants are insufficient", () => {
    expect(hasPermissions(["read"], ["write"])).toBe(false);
    expect(hasPermissions(["read", "execute"], ["write"])).toBe(false);
  });
});

describe("toolIdsForGrants", () => {
  test("plan grants return read and network tools", () => {
    const ids = toolIdsForGrants(["read", "network"]);
    expect(ids).toContain("file-read");
    expect(ids).toContain("file-find");
    expect(ids).toContain("web-search");
    expect(ids).not.toContain("file-edit");
    expect(ids).not.toContain("shell-run");
    expect(ids).not.toContain("git-add");
  });

  test("work grants return all tools", () => {
    const ids = toolIdsForGrants(["read", "write", "execute", "network"]);
    expect(ids).toContain("file-read");
    expect(ids).toContain("file-edit");
    expect(ids).toContain("shell-run");
    expect(ids).toContain("web-search");
    expect(ids).toContain("git-add");
  });

  test("verify grants return read and execute tools", () => {
    const ids = toolIdsForGrants(["read", "execute"]);
    expect(ids).toContain("file-read");
    expect(ids).toContain("shell-run");
    expect(ids).toContain("code-scan");
    expect(ids).not.toContain("file-edit");
    expect(ids).not.toContain("web-search");
    expect(ids).not.toContain("git-add");
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

    expect(readInstruction).toContain("Batch reads while discovering scope");
    expect(readInstruction).toContain("once you are editing named targets");
    expect(readInstruction).toContain("read each target separately right before its edit");
    expect(editInstruction).toContain("latest direct `file-read` of that file");
    expect(editInstruction).toContain("smallest unique snippet from the latest direct `file-read`");
    expect(editInstruction).toContain("Keep anchors tight");
    expect(editInstruction).toContain("keep line-range edits to the changed lines when possible");
    expect(editInstruction).toContain("preserve nearby path or link style");
    expect(editCodeInstruction).toContain("read that file directly right before editing it");
    expect(searchInstruction).toContain("scope with `paths` when you know the target area");
    expect(searchInstruction).toContain("edit from that evidence");
    expect(searchInstruction).toContain("keep the local reference style from the target file");
    expect(gitStatusInstruction).toContain("repository state itself matters");
    expect(gitStatusInstruction).toContain("not to re-check a file-scoped task");
    expect(gitDiffInstruction).toContain("repository diff context matters");
    expect(gitDiffInstruction).toContain("not to re-check an edit you just made");
    expect(gitLogInstruction).toContain("It is for history, not current uncommitted edits");
    expect(gitShowInstruction).toContain("It is for history, not current uncommitted edits");
    expect(runCommandInstruction).toContain("Use `shell-run` for known repository commands");
  });
});
