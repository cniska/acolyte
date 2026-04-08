import { describe, expect, test } from "bun:test";
import { toolsForAgent } from "./tool-registry";

describe("file-read tool schema", () => {
  test("accepts single path", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile.inputSchema;
    expect(schema.parse({ paths: [{ path: "src/agent.ts" }] })).toEqual({
      paths: [{ path: "src/agent.ts" }],
    });
  });

  test("accepts multiple paths", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile.inputSchema;
    expect(schema.parse({ paths: [{ path: "src/agent.ts" }, { path: "src/cli.ts" }] })).toEqual({
      paths: [{ path: "src/agent.ts" }, { path: "src/cli.ts" }],
    });
  });

  test("rejects empty paths array", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile.inputSchema;
    expect(() => schema.parse({ paths: [] })).toThrow();
  });

  test("strips unknown properties", () => {
    const { tools } = toolsForAgent();
    const schema = tools.readFile.inputSchema;
    const result = schema.parse({ paths: [{ path: "src/agent.ts", start: 10, end: 20 }] });
    expect(result).toEqual({ paths: [{ path: "src/agent.ts" }] });
  });
});

describe("file-delete tool schema", () => {
  test("requires paths array and rejects single path input", () => {
    const { tools } = toolsForAgent();
    const schema = tools.deleteFile.inputSchema;
    expect(() => schema.parse({ path: "src/agent.ts" })).toThrow();
    expect(schema.parse({ paths: ["src/agent.ts"] })).toEqual({ paths: ["src/agent.ts"] });
  });
});
