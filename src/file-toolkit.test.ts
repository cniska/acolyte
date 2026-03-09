import { describe, expect, test } from "bun:test";
import { toolsForAgent } from "./tool-registry";

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
