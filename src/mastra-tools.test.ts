import { describe, expect, test } from "bun:test";
import { toolsForRole } from "./mastra-tools";

describe("mastra role toolsets", () => {
  test("planner has minimal read-only planning tools", () => {
    const keys = Object.keys(toolsForRole("planner")).sort();
    expect(keys).toEqual(["readFile", "searchRepo"]);
  });

  test("reviewer has read-only tools", () => {
    const keys = Object.keys(toolsForRole("reviewer")).sort();
    expect(keys).toEqual(["gitDiff", "gitStatus", "readFile", "searchRepo", "webSearch"]);
  });

  test("coder has full toolset", () => {
    const keys = Object.keys(toolsForRole("coder")).sort();
    expect(keys).toEqual(["editFile", "gitDiff", "gitStatus", "readFile", "runCommand", "searchRepo", "webSearch"]);
  });
});
