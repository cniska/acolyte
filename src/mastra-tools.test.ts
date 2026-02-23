import { afterEach, describe, expect, test } from "bun:test";
import { appConfig, setPermissionMode } from "./app-config";
import { readFileTool, toolsForCoordinator, toolsForRole, withToolError } from "./mastra-tools";

const initialPermissionMode = appConfig.agent.permissions.mode;

afterEach(() => {
  setPermissionMode(initialPermissionMode);
});

describe("mastra role toolsets", () => {
  test("coordinator has read/web tools plus run-command", () => {
    const keys = Object.keys(toolsForCoordinator()).sort();
    expect(keys).toEqual(["gitDiff", "gitStatus", "readFile", "runCommand", "searchRepo", "webFetch", "webSearch"]);
  });

  test("planner has read-only planning tools", () => {
    const keys = Object.keys(toolsForRole("planner")).sort();
    expect(keys).toEqual(["gitDiff", "gitStatus", "readFile", "searchRepo", "webFetch", "webSearch"]);
  });

  test("reviewer has read-only tools", () => {
    const keys = Object.keys(toolsForRole("reviewer")).sort();
    expect(keys).toEqual(["gitDiff", "gitStatus", "readFile", "searchRepo", "webFetch", "webSearch"]);
  });

  test("coder has full toolset", () => {
    setPermissionMode("write");
    const keys = Object.keys(toolsForRole("coder")).sort();
    expect(keys).toEqual([
      "editFile",
      "gitDiff",
      "gitStatus",
      "readFile",
      "runCommand",
      "searchRepo",
      "webFetch",
      "webSearch",
    ]);
  });

  test("coder falls back to read-only tools in read mode", () => {
    setPermissionMode("read");
    const keys = Object.keys(toolsForRole("coder")).sort();
    expect(keys).toEqual(["gitDiff", "gitStatus", "readFile", "searchRepo", "webFetch", "webSearch"]);
  });
});

describe("read-file tool schema", () => {
  test("rejects invalid range when start is greater than end", () => {
    const schema = readFileTool.inputSchema;
    expect(schema).toBeDefined();
    if (!schema) {
      throw new Error("readFileTool.inputSchema is undefined");
    }
    expect(() => schema.parse({ path: "src/agent.ts", start: 20, end: 10 })).toThrow(
      "start must be less than or equal to end",
    );
  });

  test("accepts bounded ranges and single-sided ranges", () => {
    const schema = readFileTool.inputSchema;
    expect(schema).toBeDefined();
    if (!schema) {
      throw new Error("readFileTool.inputSchema is undefined");
    }
    expect(schema.parse({ path: "src/agent.ts", start: 10, end: 20 })).toEqual({
      path: "src/agent.ts",
      start: 10,
      end: 20,
    });
    expect(schema.parse({ path: "src/agent.ts", start: 10 })).toEqual({
      path: "src/agent.ts",
      start: 10,
    });
    expect(schema.parse({ path: "src/agent.ts", end: 20 })).toEqual({
      path: "src/agent.ts",
      end: 20,
    });
  });
});

describe("tool error wrapper", () => {
  test("prefixes thrown errors with tool id", async () => {
    await expect(withToolError("read-file", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "read-file failed: boom",
    );
  });
});
