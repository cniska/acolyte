import { describe, expect, test } from "bun:test";
import { readFileTool, toolsForRole } from "./mastra-tools";

describe("mastra role toolsets", () => {
  test("planner has minimal read-only planning tools", () => {
    const keys = Object.keys(toolsForRole("planner")).sort();
    expect(keys).toEqual(["readFile", "searchRepo"]);
  });

  test("reviewer has read-only tools", () => {
    const keys = Object.keys(toolsForRole("reviewer")).sort();
    expect(keys).toEqual(["gitDiff", "gitStatus", "readFile", "searchRepo", "webFetch", "webSearch"]);
  });

  test("coder has full toolset", () => {
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
});

describe("read-file tool schema", () => {
  test("rejects invalid range when start is greater than end", () => {
    expect(() => readFileTool.inputSchema.parse({ path: "src/agent.ts", start: 20, end: 10 })).toThrow(
      "start must be less than or equal to end",
    );
  });

  test("accepts bounded ranges and single-sided ranges", () => {
    expect(readFileTool.inputSchema.parse({ path: "src/agent.ts", start: 10, end: 20 })).toEqual({
      path: "src/agent.ts",
      start: 10,
      end: 20,
    });
    expect(readFileTool.inputSchema.parse({ path: "src/agent.ts", start: 10 })).toEqual({
      path: "src/agent.ts",
      start: 10,
    });
    expect(readFileTool.inputSchema.parse({ path: "src/agent.ts", end: 20 })).toEqual({
      path: "src/agent.ts",
      end: 20,
    });
  });
});
