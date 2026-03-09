import { describe, expect, test } from "bun:test";
import { renderToolOutput } from "./tool-output-content";
import { hasPermissions, toolDefinitionsById, toolIdsForGrants, toolsForAgent, writeToolIds } from "./tool-registry";

describe("toolsets", () => {
  test("returns all tools", () => {
    const { tools, session } = toolsForAgent();
    expect(Object.keys(tools).sort()).toEqual([
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
      "scanCode",
      "searchFiles",
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
    expect(ids).toContain("read-file");
    expect(ids).toContain("find-files");
    expect(ids).toContain("web-search");
    expect(ids).not.toContain("edit-file");
    expect(ids).not.toContain("run-command");
    expect(ids).not.toContain("git-add");
  });

  test("work grants return all tools", () => {
    const ids = toolIdsForGrants(["read", "write", "execute", "network"]);
    expect(ids).toContain("read-file");
    expect(ids).toContain("edit-file");
    expect(ids).toContain("run-command");
    expect(ids).toContain("web-search");
    expect(ids).toContain("git-add");
  });

  test("verify grants return read and execute tools", () => {
    const ids = toolIdsForGrants(["read", "execute"]);
    expect(ids).toContain("read-file");
    expect(ids).toContain("run-command");
    expect(ids).toContain("scan-code");
    expect(ids).not.toContain("edit-file");
    expect(ids).not.toContain("web-search");
    expect(ids).not.toContain("git-add");
  });
});

describe("writeToolIds", () => {
  test("returns tools that require write permission", () => {
    const ids = writeToolIds();
    expect(ids).toContain("edit-file");
    expect(ids).toContain("edit-code");
    expect(ids).toContain("create-file");
    expect(ids).toContain("delete-file");
    expect(ids).toContain("git-add");
    expect(ids).toContain("git-commit");
    expect(ids).not.toContain("read-file");
    expect(ids).not.toContain("run-command");
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
    expect(renderToolOutput({ kind: "truncated", count: 3, unit: "lines" })).toBe("… +3 lines");
    expect(renderToolOutput({ kind: "truncated", count: 1, unit: "lines" })).toBe("… +1 line");
    expect(renderToolOutput({ kind: "truncated", count: 5, unit: "matches" })).toBe("… +5 matches");
    expect(renderToolOutput({ kind: "truncated", count: 1, unit: "matches" })).toBe("… +1 match");
    expect(renderToolOutput({ kind: "no-output" })).toBe("(No output)");
  });
});
