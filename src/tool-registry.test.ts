import { describe, expect, test } from "bun:test";
import { invariant } from "./assert";
import { withToolError } from "./tool-execution";
import { renderToolOutput } from "./tool-output-content";
import { hasPermissions, toolDefinitionsById, toolIdsForGrants, toolsForAgent, writeToolIds } from "./tool-registry";
import { webSearchStreamRows } from "./web-toolkit";

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

describe("read-file tool schema", () => {
  test("rejects invalid range when start is greater than end", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile.inputSchema;
    expect(() => schema.parse({ paths: [{ path: "src/agent.ts", start: 20, end: 10 }] })).toThrow(
      "start must be less than or equal to end",
    );
  });

  test("accepts bounded ranges and single-sided ranges", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile.inputSchema;
    expect(schema.parse({ paths: [{ path: "src/agent.ts", start: 10, end: 20 }] })).toEqual({
      paths: [{ path: "src/agent.ts", start: 10, end: 20 }],
    });
    expect(schema.parse({ paths: [{ path: "src/agent.ts", start: 10 }] })).toEqual({
      paths: [{ path: "src/agent.ts", start: 10 }],
    });
    expect(schema.parse({ paths: [{ path: "src/agent.ts", end: 20 }] })).toEqual({
      paths: [{ path: "src/agent.ts", end: 20 }],
    });
  });

  test("accepts multiple paths", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile.inputSchema;
    expect(
      schema.parse({
        paths: [{ path: "src/agent.ts", start: 1, end: 10 }, { path: "src/cli.ts" }],
      }),
    ).toEqual({
      paths: [{ path: "src/agent.ts", start: 1, end: 10 }, { path: "src/cli.ts" }],
    });
  });
});

describe("delete-file tool schema", () => {
  test("requires paths array and rejects legacy single path input", () => {
    const { tools } = toolsForAgent();
    const schema = tools.deleteFile.inputSchema;
    expect(() => schema.parse({ path: "src/agent.ts" })).toThrow();
    expect(schema.parse({ paths: ["src/agent.ts"] })).toEqual({ paths: ["src/agent.ts"] });
  });
});

describe("tool error wrapper", () => {
  test("prefixes thrown errors with tool id", async () => {
    await expect(withToolError("read-file", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "read-file failed: boom",
    );
  });

  test("preserves structured error code on wrapped errors", async () => {
    const source = Object.assign(new Error("multi-match"), { code: "E_EDIT_FILE_MULTI_MATCH" });
    try {
      await withToolError("edit-file", async () => Promise.reject(source));
      invariant(false, "expected withToolError to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const wrapped = error as Error & { code?: string };
      expect(wrapped.message).toBe("edit-file failed: multi-match");
      expect(wrapped.code).toBe("E_EDIT_FILE_MULTI_MATCH");
    }
  });
});

describe("web-search stream rows", () => {
  test("converts web search prose output into machine rows", () => {
    const raw = [
      "Web results for: bun test",
      "1. Bun runtime docs",
      "   https://bun.sh/docs",
      "   Fast all-in-one JavaScript runtime and toolkit.",
    ].join("\n");
    expect(webSearchStreamRows(raw)).toBe(
      ['query="bun test" results=1', 'result rank=1 url="https://bun.sh/docs"'].join("\n"),
    );
  });

  test("converts no-results output into summary + no-output marker", () => {
    expect(webSearchStreamRows("No web results found for: missing query")).toBe(
      ['query="missing query" results=0', "(No output)"].join("\n"),
    );
  });

  test("limits rows to top five results and emits truncated marker", () => {
    const raw = [
      "Web results for: acolyte",
      "1. One",
      "   https://one.test",
      "2. Two",
      "   https://two.test",
      "3. Three",
      "   https://three.test",
      "4. Four",
      "   https://four.test",
      "5. Five",
      "   https://five.test",
      "6. Six",
      "   https://six.test",
      "7. Seven",
      "   https://seven.test",
    ].join("\n");

    expect(webSearchStreamRows(raw)).toBe(
      [
        'query="acolyte" results=7',
        'result rank=1 url="https://one.test"',
        'result rank=2 url="https://two.test"',
        'result rank=3 url="https://three.test"',
        'result rank=4 url="https://four.test"',
        'result rank=5 url="https://five.test"',
        "… +2 results",
      ].join("\n"),
    );
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
