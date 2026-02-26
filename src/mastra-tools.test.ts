import { afterEach, describe, expect, test } from "bun:test";
import { appConfig, setPermissionMode } from "./app-config";
import { readFileTool, toolsForAgent, withToolError } from "./mastra-tools";

const initialPermissionMode = appConfig.agent.permissions.mode;

afterEach(() => {
  setPermissionMode(initialPermissionMode);
});

describe("mastra toolsets", () => {
  test("returns full toolset in write mode", () => {
    setPermissionMode("write");
    const keys = Object.keys(toolsForAgent()).sort();
    expect(keys).toEqual([
      "deleteFile",
      "editFile",
      "findFiles",
      "gitDiff",
      "gitStatus",
      "readFile",
      "runCommand",
      "searchFiles",
      "webFetch",
      "webSearch",
    ]);
  });

  test("returns read-only tools in read mode", () => {
    setPermissionMode("read");
    const keys = Object.keys(toolsForAgent()).sort();
    expect(keys).toEqual(["findFiles", "gitDiff", "gitStatus", "readFile", "searchFiles", "webFetch", "webSearch"]);
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
