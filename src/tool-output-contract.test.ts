import { afterEach, describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runShellCommand } from "./tools";
import { formatToolHeader } from "./agent";
import { setPermissionMode } from "./app-config";
import { formatProgressOutput } from "./cli-format";
import { toolsForAgent } from "./mastra-tools";
import { createTempDir, dedent, savedPermissionMode } from "./test-factory";
import { mergeToolOutputHeader } from "./tool-summary-format";

const restorePermissions = savedPermissionMode();
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");
const stripOsc8 = (value: string): string =>
  value.replace(/\u001B\]8;;[^\u0007]*\u0007/g, "").replace(/\u001B\]8;;\u0007/g, "");
const trimRightLines = (value: string): string =>
  value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

const rawLines = (outputByTool: Map<string, string[]>, toolName: string): string[] =>
  (outputByTool.get(toolName) ?? []).map(stripOsc8);

type Harness = {
  workspace: string;
  tools: ReturnType<typeof toolsForAgent>["tools"];
  outputByTool: Map<string, string[]>;
};

async function createHarness(mode: "read" | "write"): Promise<Harness> {
  setPermissionMode(mode);
  const workspace = await createTempDir("acolyte-output-contract-");
  const outputByTool = new Map<string, string[]>();
  const { tools } = toolsForAgent({
    workspace,
    onToolOutput: (event) => {
      const bucket = outputByTool.get(event.toolName) ?? [];
      bucket.push(event.message);
      outputByTool.set(event.toolName, bucket);
    },
  });
  return { workspace, tools, outputByTool };
}

function renderMergedToolOutput(toolName: string, args: Record<string, unknown>, raw: string[]): string {
  let merged = formatToolHeader(toolName, args);
  for (const line of raw) {
    const header = !merged.includes("\n") ? mergeToolOutputHeader(merged, toolName, line) : null;
    if (header) {
      merged = header;
      continue;
    }
    merged = `${merged}\n${line}`;
  }
  return trimRightLines(stripAnsi(formatProgressOutput(merged)));
}

function assertToolOutput(
  outputByTool: Map<string, string[]>,
  toolName: string,
  args: Record<string, unknown>,
  expected: { raw: string[]; formatted: string },
): void {
  const raw = rawLines(outputByTool, toolName);
  expect(raw).toEqual(expected.raw);
  expect(renderMergedToolOutput(toolName, args, raw)).toBe(expected.formatted);
}

afterEach(restorePermissions);

describe("tool output contract: read-file", () => {
  test("emits deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      const betaPath = join(workspace, "beta.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");
      await writeFile(betaPath, 'export const beta = "needle";\n', "utf8");

      if (!tools.readFile?.execute) throw new Error("expected readFile tool to be available");
      await tools.readFile.execute({ paths: [{ path: alphaPath }, { path: betaPath }] }, {} as never);

      assertToolOutput(outputByTool, "read-file", { paths: [{ path: alphaPath }, { path: betaPath }] }, {
        raw: ["paths=2 targets=[alpha.ts, beta.ts]"],
        formatted: "• Read paths=2 targets=[alpha.ts, beta.ts]",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("summarizes many read targets with omitted count", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map((name) => join(workspace, name));
      for (const file of files) await writeFile(file, "export const v = 1;\n", "utf8");

      if (!tools.readFile?.execute) throw new Error("expected readFile tool to be available");
      await tools.readFile.execute({ paths: files.map((path) => ({ path })) }, {} as never);

      assertToolOutput(outputByTool, "read-file", { paths: files.map((path) => ({ path })) }, {
        raw: ["paths=4 targets=[a.ts, b.ts, c.ts] omitted=1"],
        formatted: "• Read paths=4 targets=[a.ts, b.ts, c.ts] omitted=1",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: find-files", () => {
  test("emits deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      const betaPath = join(workspace, "beta.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");
      await writeFile(betaPath, 'export const beta = "needle";\n', "utf8");

      if (!tools.findFiles?.execute) throw new Error("expected findFiles tool to be available");
      await tools.findFiles.execute({ patterns: ["*.ts"], maxResults: 10 }, {} as never);

      assertToolOutput(outputByTool, "find-files", { patterns: ["*.ts"], maxResults: 10 }, {
        raw: ["scope=workspace patterns=[*.ts] matches=2", "beta.ts", "alpha.ts"],
        formatted: dedent(`
          • Find scope=workspace patterns=[*.ts] matches=2
              beta.ts
              alpha.ts
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("truncates long file lists with marker", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      for (let i = 1; i <= 8; i += 1) await writeFile(join(workspace, `f${i}.ts`), `export const n${i} = ${i};\n`, "utf8");

      if (!tools.findFiles?.execute) throw new Error("expected findFiles tool to be available");
      await tools.findFiles.execute({ patterns: ["*.ts"], maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "find-files", { patterns: ["*.ts"], maxResults: 20 }, {
        raw: [
          "scope=workspace patterns=[*.ts] matches=8",
          "f1.ts",
          "f2.ts",
          "f3.ts",
          "f4.ts",
          "f5.ts",
          "[truncated] +3 files",
        ],
        formatted: dedent(`
          • Find scope=workspace patterns=[*.ts] matches=8
              f1.ts
              f2.ts
              f3.ts
              f4.ts
              f5.ts
              … +3 files
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: search-files", () => {
  test("emits deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      const betaPath = join(workspace, "beta.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");
      await writeFile(betaPath, 'export const beta = "needle";\n', "utf8");

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns: ["needle"], paths: [alphaPath, betaPath], maxResults: 10 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns: ["needle"], paths: [alphaPath, betaPath], maxResults: 10 }, {
        raw: ["scope=paths:2 patterns=[needle] matches=2", "alpha.ts [needle@1]", "beta.ts [needle@1]"],
        formatted: dedent(`
          • Search scope=paths:2 patterns=[needle] matches=2
              alpha.ts [needle@1]
              beta.ts [needle@1]
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("uses workspace scope when paths are omitted", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns: ["needle"], maxResults: 10 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns: ["needle"], maxResults: 10 }, {
        raw: ["scope=workspace patterns=[needle] matches=1", "alpha.ts [needle@1]"],
        formatted: dedent(`
          • Search scope=workspace patterns=[needle] matches=1
              alpha.ts [needle@1]
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: scan-code", () => {
  test("emits deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      const betaPath = join(workspace, "beta.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");
      await writeFile(betaPath, 'export const beta = "needle";\n', "utf8");

      if (!tools.scanCode?.execute) throw new Error("expected scanCode tool to be available");
      await tools.scanCode.execute(
        { paths: [alphaPath, betaPath], patterns: ["export const $NAME = $VALUE;"], maxResults: 10 },
        {} as never,
      );

      assertToolOutput(
        outputByTool,
        "scan-code",
        { paths: [alphaPath, betaPath], patterns: ["export const $NAME = $VALUE;"], maxResults: 10 },
        {
          raw: ["paths=2 targets=[alpha.ts, beta.ts]"],
          formatted: "• Review paths=2 targets=[alpha.ts, beta.ts]",
        },
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("summarizes many scan targets with omitted count", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map((name) => join(workspace, name));
      for (const file of files) await writeFile(file, "export const value = 1;\n", "utf8");

      if (!tools.scanCode?.execute) throw new Error("expected scanCode tool to be available");
      await tools.scanCode.execute({ paths: files, patterns: ["export const $NAME = $VALUE;"], maxResults: 10 }, {} as never);

      assertToolOutput(
        outputByTool,
        "scan-code",
        { paths: files, patterns: ["export const $NAME = $VALUE;"], maxResults: 10 },
        {
          raw: ["paths=4 targets=[a.ts, b.ts, c.ts] omitted=1"],
          formatted: "• Review paths=4 targets=[a.ts, b.ts, c.ts] omitted=1",
        },
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: create-file", () => {
  test("emits deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      if (!tools.createFile?.execute) throw new Error("expected createFile tool to be available");
      await tools.createFile.execute({ path: "created.txt", content: "first\nsecond\n" }, {} as never);

      assertToolOutput(outputByTool, "create-file", { path: "created.txt", content: "first\nsecond\n" }, {
        raw: ["path=created.txt files=1", "1  first", "2  second"],
        formatted: dedent(`
          • Create path=created.txt files=1
              1  first
              2  second
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: delete-file", () => {
  test("shows deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      const path = "doomed.txt";
      await writeFile(join(workspace, path), "remove me\n", "utf8");
      if (!tools.deleteFile?.execute) throw new Error("expected deleteFile tool to be available");
      await tools.deleteFile.execute({ path }, {} as never);

      assertToolOutput(outputByTool, "delete-file", { path }, {
        raw: [],
        formatted: "• Delete doomed.txt",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: git-status", () => {
  test("shows deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      setPermissionMode("write");
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      await writeFile(join(workspace, "tracked.txt"), "x\n", "utf8");
      await runShellCommand(workspace, "git add tracked.txt");
      await runShellCommand(workspace, "git commit -m init");
      for (let i = 1; i <= 6; i += 1) {
        await writeFile(join(workspace, `u${i}.txt`), `${i}\n`, "utf8");
      }
      await runShellCommand(workspace, "git add .");
      await runShellCommand(workspace, "git commit -m seed");
      for (let i = 1; i <= 6; i += 1) {
        await writeFile(join(workspace, `u${i}.txt`), `${i} modified\n`, "utf8");
      }
      setPermissionMode("read");
      if (!tools.gitStatus?.execute) throw new Error("expected gitStatus tool to be available");
      await tools.gitStatus.execute({}, {} as never);
      const raw = rawLines(outputByTool, "git-status");
      expect(raw.length).toBe(5);
      expect(raw[0]).toBe("M u1.txt");
      expect(raw[1]).toBe("M u2.txt");
      expect(raw[2]).toBe("[truncated] +2 lines");
      expect(raw[3]).toBe("M u5.txt");
      expect(raw[4]).toBe("M u6.txt");
      expect(renderMergedToolOutput("git-status", {}, raw)).toBe(
        dedent(`
          • Git Status
              M u1.txt
              M u2.txt
              … +2 lines
              M u5.txt
              M u6.txt
        `),
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: git-diff", () => {
  test("shows deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      setPermissionMode("write");
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      await writeFile(join(workspace, "a.ts"), "export const a = 1;\n", "utf8");
      await runShellCommand(workspace, "git add a.ts");
      await runShellCommand(workspace, "git commit -m init");
      await writeFile(join(workspace, "a.ts"), "export const a = 2;\n", "utf8");
      setPermissionMode("read");

      if (!tools.gitDiff?.execute) throw new Error("expected gitDiff tool to be available");
      await tools.gitDiff.execute({ path: "a.ts", contextLines: 1 }, {} as never);
      const raw = rawLines(outputByTool, "git-diff");
      expect(raw).toHaveLength(5);
      expect(raw[0]).toBe("diff --git a/a.ts b/a.ts");
      expect(raw[1]?.startsWith("index ")).toBe(true);
      expect(raw[2]).toBe("[truncated] +3 lines");
      expect(raw[3]).toBe("-export const a = 1;");
      expect(raw[4]).toBe("+export const a = 2;");
      expect(renderMergedToolOutput("git-diff", { path: "a.ts", contextLines: 1 }, raw)).toBe(
        dedent(`
          • Git Diff a.ts
              diff --git a/a.ts b/a.ts
              ${raw[1]}
              … +3 lines
              -export const a = 1;
              +export const a = 2;
        `),
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: edit tools", () => {
  const buildLines = (count: number): string[] => Array.from({ length: count }, (_, i) => `const line${i + 1} = ${i + 1};`);
  const editTools: Array<"edit-file" | "edit-code"> = ["edit-file", "edit-code"];

  async function applyEdits(
    toolName: (typeof editTools)[number],
    tools: ReturnType<typeof toolsForAgent>["tools"],
    path: string,
    targets: number[],
  ): Promise<void> {
    if (toolName === "edit-file") {
      if (!tools.editFile?.execute) throw new Error("expected editFile tool to be available");
      await tools.editFile.execute(
        {
          path,
          edits: targets.map((line) => ({ find: `const line${line} = ${line};`, replace: `const line${line} = ${line}000;` })),
        },
        {} as never,
      );
      return;
    }
    if (!tools.editCode?.execute) throw new Error("expected editCode tool to be available");
    await tools.editCode.execute(
      {
        path,
        edits: targets.map((line) => ({ pattern: `const line${line} = $VALUE;`, replacement: `const line${line} = ${line}000;` })),
      },
      {} as never,
    );
  }

  test.each(editTools.map((toolName) => [toolName] as const))("%s: single edit emits deterministic output", async (toolName) => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      await writeFile(join(workspace, "notes.ts"), `${buildLines(20).join("\n")}\n`, "utf8");
      await applyEdits(toolName, tools, "notes.ts", [10]);

      assertToolOutput(outputByTool, toolName, { path: "notes.ts" }, {
        raw: [
          "path=notes.ts files=1 added=1 removed=1",
          "[truncated]",
          "7  const line7 = 7;",
          "8  const line8 = 8;",
          "9  const line9 = 9;",
          "10 - const line10 = 10;",
          "10 + const line10 = 10000;",
          "11  const line11 = 11;",
          "12  const line12 = 12;",
          "13  const line13 = 13;",
          "[truncated]",
        ],
        formatted: dedent(`
          • Edit path=notes.ts files=1 added=1 removed=1
               …
               7  const line7 = 7;
               8  const line8 = 8;
               9  const line9 = 9;
              10  const line10 = 10;
              10  const line10 = 10000;
              11  const line11 = 11;
              12  const line12 = 12;
              13  const line13 = 13;
               …
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test.each(editTools.map((toolName) => [toolName] as const))("%s: middle truncation between edit windows", async (toolName) => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      await writeFile(join(workspace, "notes.ts"), `${buildLines(30).join("\n")}\n`, "utf8");
      await applyEdits(toolName, tools, "notes.ts", [10, 28]);

      assertToolOutput(outputByTool, toolName, { path: "notes.ts" }, {
        raw: [
          "path=notes.ts files=1 added=2 removed=2",
          "[truncated]",
          "7  const line7 = 7;",
          "8  const line8 = 8;",
          "9  const line9 = 9;",
          "10 - const line10 = 10;",
          "10 + const line10 = 10000;",
          "11  const line11 = 11;",
          "12  const line12 = 12;",
          "13  const line13 = 13;",
          "[truncated]",
          "25  const line25 = 25;",
          "26  const line26 = 26;",
          "27  const line27 = 27;",
          "28 - const line28 = 28;",
          "28 + const line28 = 28000;",
          "29  const line29 = 29;",
          "30  const line30 = 30;",
        ],
        formatted: dedent(`
          • Edit path=notes.ts files=1 added=2 removed=2
               …
               7  const line7 = 7;
               8  const line8 = 8;
               9  const line9 = 9;
              10  const line10 = 10;
              10  const line10 = 10000;
              11  const line11 = 11;
              12  const line12 = 12;
              13  const line13 = 13;
               …
              25  const line25 = 25;
              26  const line26 = 26;
              27  const line27 = 27;
              28  const line28 = 28;
              28  const line28 = 28000;
              29  const line29 = 29;
              30  const line30 = 30;
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test.each(editTools.map((toolName) => [toolName] as const))("%s: near end truncates only at start", async (toolName) => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      await writeFile(join(workspace, "notes.ts"), `${buildLines(120).join("\n")}\n`, "utf8");
      await applyEdits(toolName, tools, "notes.ts", [119]);

      assertToolOutput(outputByTool, toolName, { path: "notes.ts" }, {
        raw: [
          "path=notes.ts files=1 added=1 removed=1",
          "[truncated]",
          "116  const line116 = 116;",
          "117  const line117 = 117;",
          "118  const line118 = 118;",
          "119 - const line119 = 119;",
          "119 + const line119 = 119000;",
          "120  const line120 = 120;",
        ],
        formatted: dedent(`
          • Edit path=notes.ts files=1 added=1 removed=1
                …
              116  const line116 = 116;
              117  const line117 = 117;
              118  const line118 = 118;
              119  const line119 = 119;
              119  const line119 = 119000;
              120  const line120 = 120;
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: run-command", () => {
  test("shows deterministic head-tail truncation output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      if (!tools.runCommand?.execute) throw new Error("expected runCommand tool to be available");
      const command = `printf '%s\\n' line1 line2 line3 line4 line5 line6`;
      await tools.runCommand.execute({ command }, {} as never);

      assertToolOutput(outputByTool, "run-command", { command }, {
        raw: ["out | line1", "out | line2", "[truncated] +2 lines", "out | line5", "out | line6"],
        formatted: dedent(`
          • Run printf '%s\\n' line1 line2 line3 line4 line5 line6
              line1
              line2
              … +2 lines
              line5
              line6
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows stderr output rows when command fails", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      if (!tools.runCommand?.execute) throw new Error("expected runCommand tool to be available");
      const command = `sh -c 'echo out; echo err 1>&2; exit 1'`;
      await tools.runCommand.execute({ command }, {} as never);

      assertToolOutput(outputByTool, "run-command", { command }, {
        raw: ["out | out", "err | err"],
        formatted: dedent(`
          • Run sh -c 'echo out; echo err 1>&2; exit 1'
              out
              err
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows no output placeholder when command produces nothing", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      if (!tools.runCommand?.execute) throw new Error("expected runCommand tool to be available");
      const command = `sh -c ':'`;
      await tools.runCommand.execute({ command }, {} as never);

      assertToolOutput(outputByTool, "run-command", { command }, {
        raw: ["[no-output]"],
        formatted: dedent(`
          • Run sh -c ':'
              (No output)
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
