import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPermissionMode } from "./app-config";
import { toolsForAgent, withToolError } from "./mastra-tools";
import { savedPermissionMode } from "./test-factory";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";

const restorePermissions = savedPermissionMode();
const stripOsc8 = (value: string): string =>
  value.replace(/\u001B\]8;;[^\u0007]*\u0007/g, "").replace(/\u001B\]8;;\u0007/g, "");

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

describe("write tool output contract", () => {
  test("edit/create/edit-code emit numbered diff preview lines while delete stays header-only", async () => {
    setPermissionMode("write");
    const workspace = await mkdtemp(join(tmpdir(), "acolyte-tools-contract-"));
    try {
      const tsPath = join(workspace, "example.ts");
      const txtPath = join(workspace, "notes.txt");
      await writeFile(tsPath, 'export function hello(): string {\n  return "world";\n}\n', "utf8");
      await writeFile(txtPath, "alpha\n", "utf8");
      const outputByTool = new Map<string, string[]>();
      const pushOutput = (toolName: string, message: string): void => {
        const bucket = outputByTool.get(toolName) ?? [];
        bucket.push(message);
        outputByTool.set(toolName, bucket);
      };
      const { tools } = toolsForAgent({
        workspace,
        onToolOutput: (event) => pushOutput(event.toolName, event.message),
      });
      const editFileTool = tools.editFile;
      const createFileTool = tools.createFile;
      const editCodeTool = tools.editCode;
      const deleteFileTool = tools.deleteFile;
      if (!editFileTool || !createFileTool || !editCodeTool || !deleteFileTool)
        throw new Error("expected write tools to be available in write mode");
      const editFileExecute = editFileTool.execute;
      const createFileExecute = createFileTool.execute;
      const editCodeExecute = editCodeTool.execute;
      const deleteFileExecute = deleteFileTool.execute;
      if (!editFileExecute || !createFileExecute || !editCodeExecute || !deleteFileExecute)
        throw new Error("expected write tool execute methods");
      const runtime = {} as never;

      await editFileExecute(
        {
          path: txtPath,
          edits: [{ startLine: 1, endLine: 1, replace: "beta" }],
        },
        runtime,
      );
      await createFileExecute(
        {
          path: join(workspace, "created.txt"),
          content: "first\nsecond\n",
        },
        runtime,
      );
      await editCodeExecute(
        {
          path: tsPath,
          edits: [{ pattern: "function hello(): string { $BODY }", replacement: "function greet(): string { $BODY }" }],
        },
        runtime,
      );
      await deleteFileExecute({ path: join(workspace, "created.txt") }, runtime);

      const hasNumberedDiff = (lines: string[]): boolean => lines.some((line) => /^\d+\s+[+-]\s/.test(line));
      expect(hasNumberedDiff(outputByTool.get("edit-file") ?? [])).toBe(true);
      expect(hasNumberedDiff(outputByTool.get("create-file") ?? [])).toBe(true);
      expect(hasNumberedDiff(outputByTool.get("edit-code") ?? [])).toBe(true);
      expect(outputByTool.get("delete-file") ?? []).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("read/scan tool output contract", () => {
  test("read-file emits compact file list summary capped to five files", async () => {
    setPermissionMode("read");
    const workspace = await mkdtemp(join(tmpdir(), "acolyte-read-contract-"));
    try {
      const paths = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"].map((file) => join(workspace, file));
      for (const [index, path] of paths.entries())
        await writeFile(path, `export const v${index + 1} = ${index + 1};\n`, "utf8");

      const outputByTool = new Map<string, string[]>();
      const { tools } = toolsForAgent({
        workspace,
        onToolOutput: (event) => {
          const bucket = outputByTool.get(event.toolName) ?? [];
          bucket.push(event.message);
          outputByTool.set(event.toolName, bucket);
        },
      });
      const readFileTool = tools.readFile;
      if (!readFileTool?.execute) throw new Error("expected readFile tool to be available");
      await readFileTool.execute(
        {
          paths: paths.map((path) => ({ path })),
        },
        {} as never,
      );

      const lines = outputByTool.get("read-file") ?? [];
      const plain = lines.map(stripOsc8);
      expect(lines[0]).toBe("Read 7 files");
      expect(plain.slice(1, 6)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
      expect(plain[6]).toBe("… +2 files");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("find-files and search-files emit compact file list summaries", async () => {
    setPermissionMode("read");
    const workspace = await mkdtemp(join(tmpdir(), "acolyte-discovery-contract-"));
    try {
      const alphaPath = join(workspace, "alpha.ts");
      const betaPath = join(workspace, "beta.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");
      await writeFile(betaPath, 'export const beta = "needle";\n', "utf8");

      const outputByTool = new Map<string, string[]>();
      const { tools } = toolsForAgent({
        workspace,
        onToolOutput: (event) => {
          const bucket = outputByTool.get(event.toolName) ?? [];
          bucket.push(event.message);
          outputByTool.set(event.toolName, bucket);
        },
      });

      const findFilesTool = tools.findFiles;
      const searchFilesTool = tools.searchFiles;
      if (!findFilesTool?.execute || !searchFilesTool?.execute)
        throw new Error("expected findFiles/searchFiles tools to be available");

      await findFilesTool.execute({ patterns: ["*.ts"], maxResults: 10 }, {} as never);
      await searchFilesTool.execute({ pattern: "needle", maxResults: 10 }, {} as never);

      const findLines = outputByTool.get("find-files") ?? [];
      const plainFind = findLines.map(stripOsc8);
      expect(findLines[0]).toBe("Find using [*.ts]");
      expect(plainFind).toContain("alpha.ts");
      expect(plainFind).toContain("beta.ts");

      const searchLines = outputByTool.get("search-files") ?? [];
      const plainSearch = searchLines.map(stripOsc8);
      expect(searchLines[0]).toBe("Search using [needle]");
      expect(plainSearch).toContain("alpha.ts [needle@1]");
      expect(plainSearch).toContain("beta.ts [needle@1]");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("search-files emits scoped header and pattern line hits", async () => {
    setPermissionMode("read");
    const workspace = await mkdtemp(join(tmpdir(), "acolyte-search-summary-"));
    try {
      const filePath = join(workspace, "alpha.ts");
      await writeFile(filePath, 'export const tool = "x";\nexport const agent = "y";\n', "utf8");

      const outputByTool = new Map<string, string[]>();
      const { tools } = toolsForAgent({
        workspace,
        onToolOutput: (event) => {
          const bucket = outputByTool.get(event.toolName) ?? [];
          bucket.push(event.message);
          outputByTool.set(event.toolName, bucket);
        },
      });

      const searchFilesTool = tools.searchFiles;
      if (!searchFilesTool?.execute) throw new Error("expected searchFiles tool to be available");

      await searchFilesTool.execute(
        { patterns: ["\\btool\\b", "\\bagent\\b"], paths: [filePath], maxResults: 20 },
        {} as never,
      );

      const searchLines = (outputByTool.get("search-files") ?? []).map(stripOsc8);
      expect(searchLines[0]).toBe("Search alpha.ts using [tool, agent]");
      expect(searchLines[1]).toBe("alpha.ts [tool@1, agent@2]");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
