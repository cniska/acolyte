import { afterEach, describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setPermissionMode } from "./app-config";
import { formatProgressEventOutput } from "./cli-format";
import { toolsForAgent } from "./mastra-tools";
import { createTempDir, savedPermissionMode } from "./test-factory";

const restorePermissions = savedPermissionMode();
const stripOsc8 = (value: string): string =>
  value.replace(/\u001B\]8;;[^\u0007]*\u0007/g, "").replace(/\u001B\]8;;\u0007/g, "");
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");
const toolOutputLines = (outputByTool: Map<string, string[]>, toolName: string): string[] =>
  (outputByTool.get(toolName) ?? []).map(stripOsc8);
const block = (value: string): string =>
  value
    .split("\n")
    .map((line) => line.replace(/^ {6}/, ""))
    .join("\n")
    .trim();

afterEach(restorePermissions);

describe("tool output contract", () => {
  test("read/find/search/scan emit deterministic raw and rendered blocks", async () => {
    setPermissionMode("read");
    const workspace = await createTempDir("acolyte-output-contract-");
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
      const readFileTool = tools.readFile;
      const scanCodeTool = tools.scanCode;
      if (!findFilesTool?.execute || !searchFilesTool?.execute || !readFileTool?.execute || !scanCodeTool?.execute)
        throw new Error("expected read/find/search/scan tools to be available");

      await findFilesTool.execute({ patterns: ["*.ts"], maxResults: 10 }, {} as never);
      await searchFilesTool.execute({ patterns: ["needle"], paths: [alphaPath, betaPath], maxResults: 10 }, {} as never);
      await readFileTool.execute({ paths: [{ path: alphaPath }, { path: betaPath }] }, {} as never);
      await scanCodeTool.execute(
        { paths: [alphaPath, betaPath], patterns: ["export const $NAME = $VALUE;"], maxResults: 10 },
        {} as never,
      );

      const findRaw = toolOutputLines(outputByTool, "find-files");
      const searchRaw = toolOutputLines(outputByTool, "search-files");
      const readRaw = toolOutputLines(outputByTool, "read-file");
      const scanRaw = toolOutputLines(outputByTool, "scan-code");

      const findExpected = {
        raw: [
          "Find using [*.ts]",
          "beta.ts",
          "alpha.ts",
        ],
        formatted: block(`
      • Find using [*.ts]
          beta.ts
          alpha.ts
      `),
      };
      const searchExpected = {
        raw: [
          "Search 2 paths using [needle]",
          "alpha.ts [needle@1]",
          "beta.ts [needle@1]",
        ],
        formatted: block(`
      • Search 2 paths using [needle]
          alpha.ts [needle@1]
          beta.ts [needle@1]
      `),
      };
      const readExpected = { raw: ["Read alpha.ts, beta.ts"], formatted: "• Read alpha.ts, beta.ts" };
      const scanExpected = { raw: ["Review alpha.ts, beta.ts"], formatted: "• Review alpha.ts, beta.ts" };

      expect(findRaw).toEqual(findExpected.raw);
      expect(searchRaw).toEqual(searchExpected.raw);
      expect(readRaw).toEqual(readExpected.raw);
      expect(scanRaw).toEqual(scanExpected.raw);

      expect(stripAnsi(formatProgressEventOutput(findRaw.join("\n")))).toBe(findExpected.formatted);
      expect(stripAnsi(formatProgressEventOutput(searchRaw.join("\n")))).toBe(searchExpected.formatted);
      expect(stripAnsi(formatProgressEventOutput(readRaw.join("\n")))).toBe(readExpected.formatted);
      expect(stripAnsi(formatProgressEventOutput(scanRaw.join("\n")))).toBe(scanExpected.formatted);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("write tools emit deterministic raw and rendered blocks", async () => {
    setPermissionMode("write");
    const workspace = await createTempDir("acolyte-write-output-contract-");
    try {
      await writeFile(join(workspace, "example.ts"), 'export function hello(): string {\n  return "world";\n}\n', "utf8");
      await writeFile(join(workspace, "notes.txt"), "alpha\n", "utf8");

      const outputByTool = new Map<string, string[]>();
      const { tools } = toolsForAgent({
        workspace,
        onToolOutput: (event) => {
          const bucket = outputByTool.get(event.toolName) ?? [];
          bucket.push(event.message);
          outputByTool.set(event.toolName, bucket);
        },
      });

      const editFileTool = tools.editFile;
      const createFileTool = tools.createFile;
      const editCodeTool = tools.editCode;
      const deleteFileTool = tools.deleteFile;
      if (!editFileTool?.execute || !createFileTool?.execute || !editCodeTool?.execute || !deleteFileTool?.execute)
        throw new Error("expected write tools to be available");

      await editFileTool.execute({ path: "notes.txt", edits: [{ startLine: 1, endLine: 1, replace: "beta" }] }, {} as never);
      await createFileTool.execute({ path: "created.txt", content: "first\nsecond\n" }, {} as never);
      await editCodeTool.execute(
        { path: "example.ts", edits: [{ pattern: "function hello(): string { $BODY }", replacement: "function greet(): string { $BODY }" }] },
        {} as never,
      );
      await deleteFileTool.execute({ path: "created.txt" }, {} as never);

      const editRaw = toolOutputLines(outputByTool, "edit-file");
      const createRaw = toolOutputLines(outputByTool, "create-file");
      const editCodeRaw = toolOutputLines(outputByTool, "edit-code");
      const deleteRaw = toolOutputLines(outputByTool, "delete-file");

      expect(editRaw).toEqual([
        "Edit notes.txt (+1 -1)",
        "1 - alpha",
        "1 + beta",
      ]);
      expect(createRaw).toEqual([
        "Create created.txt (+2 -0)",
        "1 + first",
        "2 + second",
      ]);
      expect(editCodeRaw).toEqual([
        "Edit example.ts (+1 -3)",
        "1 - export function hello(): string {",
        '2 -   return "world";',
        "3 - }",
        '1 + export function greet(): string { return "world"; }',
      ]);
      expect(deleteRaw).toEqual([]);

      const renderedEdit = stripAnsi(formatProgressEventOutput(editRaw.join("\n")));
      expect(renderedEdit.startsWith("• Edit notes.txt (+1 -1)")).toBe(true);
      expect(renderedEdit).toContain("1 -alpha");
      expect(renderedEdit).toContain("1 +beta");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("run-command emits deterministic raw and rendered head+tail blocks", async () => {
    setPermissionMode("write");
    const workspace = await createTempDir("acolyte-run-output-");
    try {
      const outputByTool = new Map<string, string[]>();
      const { tools } = toolsForAgent({
        workspace,
        onToolOutput: (event) => {
          const bucket = outputByTool.get(event.toolName) ?? [];
          bucket.push(event.message);
          outputByTool.set(event.toolName, bucket);
        },
      });
      const runCommandTool = tools.runCommand;
      if (!runCommandTool?.execute) throw new Error("expected runCommand tool to be available");

      await runCommandTool.execute({ command: `printf '%s\n' line1 line2 line3 line4 line5 line6` }, {} as never);

      const runRaw = toolOutputLines(outputByTool, "run-command");
      const expectedRun = {
        raw: [
          "out | line1",
          "out | line2",
          "… +2 lines",
          "out | line5",
          "out | line6",
        ],
        formatted: block(`
      • line1
          line2
          … +2 lines
          line5
          line6
      `),
      };
      expect(runRaw).toEqual(expectedRun.raw);
      expect(stripAnsi(formatProgressEventOutput(runRaw.join("\n")))).toBe(expectedRun.formatted);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
