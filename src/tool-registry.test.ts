import { describe, expect, test } from "bun:test";
import { ghInstalled } from "./gh-ops";
import { expectIntent } from "./test-utils";
import { renderToolOutput } from "./tool-output-render";
import { toolDefinitionsById, toolIds, toolIdsByCategory, toolsForAgent } from "./tool-registry";

describe("toolsets", () => {
  test("returns all tools", () => {
    const { tools, session } = toolsForAgent();
    const coreTools = [
      "activateSkill",
      "createTasklist",
      "createFile",
      "deactivateSkill",
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
      "listUndo",
      "memoryAdd",
      "memoryObserve",
      "memorySearch",
      "readFile",
      "restoreUndo",
      "runCommand",
      "runTests",
      "scanCode",
      "searchFiles",
      "sessionSearch",
      "updateTasklist",
      "webFetch",
      "webSearch",
    ];
    const ghTools = ["ghIssueCreate", "ghIssueList", "ghPrCreate", "ghPrEdit", "ghPrView"];
    const expected = ghInstalled() ? [...coreTools, ...ghTools].sort() : coreTools;
    expect(Object.keys(tools).sort()).toEqual(expected);
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
    expect(ids).toContain("undo-list");
    expect(ids).toContain("undo-restore");
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
    expect(ids).toContain("undo-restore");
    expect(ids).not.toContain("tasklist-update");
    expect(ids).not.toContain("file-read");
    expect(ids).not.toContain("shell-run");
    expect(ids).not.toContain("web-search");
  });
});

describe("localization baseline", () => {
  test("tool ids stay language-neutral", () => {
    const toolNamePattern = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
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

describe("model-facing tool text", () => {
  // A tool's instruction is hoisted into the system prompt for every turn, whether or not the
  // tool gets used. Only a handoff between two tools earns that: anything a tool can say about
  // itself belongs in its own description, next to its schema.
  test("only cross-tool handoffs are hoisted into the system prompt", () => {
    const hoisted = toolIds().filter((id) => toolDefinitionsById[id]?.instruction);
    expect(hoisted.sort()).toEqual(["code-scan", "file-read", "tasklist-create"]);

    for (const id of hoisted) {
      const instruction = toolDefinitionsById[id]?.instruction ?? "";
      const named = toolIds().filter((other) => instruction.includes(`\`${other}\``));
      expect(named).toContain(id);
      expect(named.length).toBeGreaterThan(1);
    }
  });

  // A parameter fact belongs on the parameter, where it reaches the model inside the property
  // being filled and dies with the field it documents.
  test("parameter contracts ship on their own parameters", () => {
    const described = (id: string, param: string): string => {
      const properties = (
        toolDefinitionsById[id]?.inputSchema as { properties?: Record<string, { description?: string }> }
      )?.properties;
      return properties?.[param]?.description ?? "";
    };
    expectIntent(described("undo-restore", "checkpointId"), [["undo-list"]]);
    expectIntent(described("undo-restore", "paths"), [["undo-list"]]);
    expectIntent(described("file-read", "offset"), [["too large to read whole"]]);
  });

  // Whether to commit at all is the user's call, and no other surface carries it: soul.md is
  // silent, and a workspace without an equivalent project rule would lose it entirely.
  test("git-commit states that committing waits for the user", () => {
    expectIntent(toolDefinitionsById["git-commit"]?.description ?? "", [["only when the user asks"]]);
  });

  // Vocabulary a tool no longer supports must be gone from the schema surface, not merely
  // de-emphasized, and a tool's trigger ships with its schema rather than in the system prompt.
  test("tool descriptions carry each tool's own contract", () => {
    const readDescription = toolDefinitionsById["file-read"]?.description ?? "";
    expect(readDescription).not.toContain("aroundLine");
    expect(readDescription).not.toContain("contextLines");
    expectIntent(readDescription, [["offset"], ["limit"], ["token ceiling"]]);
    expectIntent(toolDefinitionsById["session-search"]?.description ?? "", [
      ["keyword"],
      ["already in context"],
      ["rather than asking the user to repeat"],
    ]);
  });
});
