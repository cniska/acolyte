import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPermissionMode } from "./app-config";
import { toolsForAgent, withToolError } from "./mastra-tools";
import { savedPermissionMode } from "./test-factory";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";

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
  const { tools } = toolsForAgent();
  if (!tools.readFile) throw new Error("readFile tool missing");
  const readFileTool = tools.readFile;

  test("rejects invalid range when start is greater than end", () => {
    const schema = readFileTool.inputSchema;
    expect(schema).toBeDefined();
    if (!schema) throw new Error("readFileTool.inputSchema is undefined");
    expect(() => schema.parse({ paths: [{ path: "src/agent.ts", start: 20, end: 10 }] })).toThrow(
      "start must be less than or equal to end",
    );
  });

  test("accepts bounded ranges and single-sided ranges", () => {
    const schema = readFileTool.inputSchema;
    expect(schema).toBeDefined();
    if (!schema) throw new Error("readFileTool.inputSchema is undefined");
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
    const schema = readFileTool.inputSchema;
    expect(schema).toBeDefined();
    if (!schema) throw new Error("readFileTool.inputSchema is undefined");
    expect(
      schema.parse({
        paths: [{ path: "src/agent.ts", start: 1, end: 10 }, { path: "src/cli.ts" }],
      }),
    ).toEqual({
      paths: [{ path: "src/agent.ts", start: 1, end: 10 }, { path: "src/cli.ts" }],
    });
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

  test("preserves guard-blocked code from guarded execution", async () => {
    setPermissionMode("write");
    const { tools } = toolsForAgent({ workspace: process.cwd() });
    const runCommand = tools.runCommand;
    if (!runCommand?.execute) throw new Error("runCommand tool missing");
    const runtime = {} as never;
    await runCommand.execute({ command: "echo verify" }, runtime);
    try {
      await runCommand.execute({ command: "echo verify" }, runtime);
      throw new Error("expected duplicate verify guard to block");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const wrapped = error as Error & { code?: string };
      expect(wrapped.code).toBe(LIFECYCLE_ERROR_CODES.guardBlocked);
      expect(wrapped.message).toContain("run-command failed:");
    }
  });
});
