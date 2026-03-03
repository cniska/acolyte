import { afterEach, describe, expect, test } from "bun:test";
import { setPermissionMode } from "./app-config";
import { invariant } from "./assert";
import { toolsForAgent, webSearchStreamRows, withToolError } from "./mastra-tools";
import { savedPermissionMode } from "./test-utils";

const restorePermissions = savedPermissionMode();

afterEach(restorePermissions);

describe("mastra toolsets", () => {
  test("returns full toolset in write mode", () => {
    setPermissionMode("write");
    const { tools, session } = toolsForAgent();
    expect(Object.keys(tools).sort()).toEqual([
      "createFile",
      "deleteFile",
      "editCode",
      "editFile",
      "findFiles",
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

  test("returns read-only tools in read mode", () => {
    setPermissionMode("read");
    const { tools } = toolsForAgent();
    expect(Object.keys(tools).sort()).toEqual([
      "findFiles",
      "gitDiff",
      "gitLog",
      "gitShow",
      "gitStatus",
      "readFile",
      "scanCode",
      "searchFiles",
      "webFetch",
      "webSearch",
    ]);
  });
});

describe("read-file tool schema", () => {
  test("rejects invalid range when start is greater than end", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile?.inputSchema;
    expect(schema).toBeDefined();
    invariant(schema, "readFileTool.inputSchema is undefined");
    expect(() => schema.parse({ paths: [{ path: "src/agent.ts", start: 20, end: 10 }] })).toThrow(
      "start must be less than or equal to end",
    );
  });

  test("accepts bounded ranges and single-sided ranges", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile?.inputSchema;
    expect(schema).toBeDefined();
    invariant(schema, "readFileTool.inputSchema is undefined");
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
    const schema = tools.readFile?.inputSchema;
    expect(schema).toBeDefined();
    invariant(schema, "readFileTool.inputSchema is undefined");
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
    setPermissionMode("write");
    const { tools } = toolsForAgent();
    const schema = tools.deleteFile?.inputSchema;
    expect(schema).toBeDefined();
    invariant(schema, "deleteFileTool.inputSchema is undefined");
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
      throw new Error("expected withToolError to throw");
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
      ['query="missing query" results=0', "[no-output]"].join("\n"),
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
        "[truncated] +2 results",
      ].join("\n"),
    );
  });
});
