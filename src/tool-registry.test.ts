import { describe, expect, test } from "bun:test";
import { DEFAULT_FEATURE_FLAGS } from "./feature-flags-contract";
import { ghInstalled } from "./gh-ops";
import { expectIntent } from "./test-utils";
import type { ToolDefinition } from "./tool-contract";
import { renderToolOutput } from "./tool-output-render";
import { toolsForAgent } from "./tool-registry";

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
      "memorySearch",
      "readFile",
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
    expect(session.writeTools.has("undo-restore")).toBe(false);
  });

  test("includes undo tools and write classification when undo checkpoints are enabled", () => {
    const { tools, session } = toolsForAgent({ features: { ...DEFAULT_FEATURE_FLAGS, undoCheckpoints: true } });
    expect(Object.keys(tools)).toContain("listUndo");
    expect(Object.keys(tools)).toContain("restoreUndo");
    expect(session.writeTools.has("undo-restore")).toBe(true);
  });
});

function defaultToolsById(): Record<string, ToolDefinition> {
  return Object.fromEntries(Object.values(toolsForAgent().tools).map((tool) => [tool.id, tool]));
}

function defaultToolIds(): string[] {
  return Object.keys(defaultToolsById()).sort();
}

describe("toolIds", () => {
  test("returns the default tool ids in sorted order", () => {
    const ids = defaultToolIds();
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("file-read");
    expect(ids).toContain("file-edit");
    expect(ids).not.toContain("undo-list");
    expect(ids).not.toContain("undo-restore");
    expect(ids).toContain("shell-run");
    expect(ids).toContain("web-search");
    expect(ids).toContain("git-add");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("write category", () => {
  test("write category returns the default write tools only", () => {
    const ids = Object.values(defaultToolsById())
      .filter((tool) => tool.category === "write")
      .map((tool) => tool.id);
    expect(ids).toContain("file-edit");
    expect(ids).toContain("code-edit");
    expect(ids).toContain("file-create");
    expect(ids).toContain("file-delete");
    expect(ids).toContain("git-add");
    expect(ids).toContain("git-commit");
    expect(ids).not.toContain("undo-restore");
    expect(ids).not.toContain("tasklist-update");
    expect(ids).not.toContain("file-read");
    expect(ids).not.toContain("shell-run");
    expect(ids).not.toContain("web-search");
  });
});

describe("localization baseline", () => {
  test("tool ids stay language-neutral", () => {
    const toolNamePattern = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
    const allFlagsOn = Object.fromEntries(Object.keys(DEFAULT_FEATURE_FLAGS).map((flag) => [flag, true]));
    const everyTool = toolsForAgent({ features: allFlagsOn as typeof DEFAULT_FEATURE_FLAGS }).tools;
    for (const tool of Object.values(everyTool)) {
      expect(tool.id).toMatch(toolNamePattern);
    }
  });

  test("tool output content renders marker tokens", () => {
    expect(renderToolOutput({ kind: "truncated", count: 3, unit: "lines" })).toBe("⋮ +3 lines");
    expect(renderToolOutput({ kind: "truncated", count: 1, unit: "lines" })).toBe("⋮ +1 line");
    expect(renderToolOutput({ kind: "truncated", count: 5, unit: "matches" })).toBe("⋮ +5 matches");
    expect(renderToolOutput({ kind: "truncated", count: 1, unit: "matches" })).toBe("⋮ +1 match");
    expect(renderToolOutput({ kind: "no-output" })).toBe("(No output)");
  });
});

describe("model-facing tool text", () => {
  test("parameter contracts ship on their own parameters", () => {
    const described = (id: string, param: string): string => {
      const properties = (
        defaultToolsById()[id]?.inputSchema as { properties?: Record<string, { description?: string }> }
      )?.properties;
      return properties?.[param]?.description ?? "";
    };
    const { tools } = toolsForAgent({ features: { ...DEFAULT_FEATURE_FLAGS, undoCheckpoints: true } });
    const undoRestore = Object.values(tools).find((tool) => tool.id === "undo-restore");
    const undoProperties = undoRestore?.inputSchema as { properties?: Record<string, { description?: string }> };
    expectIntent(undoProperties?.properties?.checkpointId?.description ?? "", [["undo-list"]]);
    expectIntent(undoProperties?.properties?.paths?.description ?? "", [["undo-list"]]);
    expectIntent(described("file-read", "offset"), [["too large to read whole"]]);
  });

  // A workspace with no project rule on committing would otherwise lose the default entirely:
  // soul.md is silent, so the fallback ships on the tool itself.
  test("git-commit defers to the project rule and falls back to asking", () => {
    expectIntent(defaultToolsById()["git-commit"]?.description ?? "", [["project's rule"], ["when the user asks"]]);
  });

  // Vocabulary a tool no longer supports must be gone from the schema surface, not merely
  // de-emphasized, and a tool's trigger ships with its schema rather than in the system prompt.
  test("tool descriptions carry each tool's own contract", () => {
    const readDescription = defaultToolsById()["file-read"]?.description ?? "";
    expect(readDescription).not.toContain("aroundLine");
    expect(readDescription).not.toContain("contextLines");
    expectIntent(readDescription, [["offset"], ["limit"], ["token ceiling"]]);
    expectIntent(defaultToolsById()["session-search"]?.description ?? "", [
      ["keyword"],
      ["already in context"],
      ["rather than asking the user to repeat"],
    ]);
  });
});
