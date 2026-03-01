import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

type ToolOutputExpectation = {
  raw: string[];
  formatted?: string;
};

const normalizeDynamicToken = (value: string): string =>
  value
    .replace(/^index [0-9a-f]+\.\.[0-9a-f]+ (\d+)$/gm, "index <hash>..<hash> $1")
    .replace(/^([0-9a-f]{7,40})\s+\([^)]+\)\s+/gm, "<hash> ")
    .replace(/^([0-9a-f]{7,40})\s+/gm, "<hash> ");

function assertToolOutput(
  outputByTool: Map<string, string[]>,
  toolName: string,
  args: Record<string, unknown>,
  expected: ToolOutputExpectation,
): void {
  const raw = rawLines(outputByTool, toolName).map(normalizeDynamicToken);
  expect(raw).toEqual(expected.raw.map(normalizeDynamicToken));
  if (expected.formatted === undefined) return;
  const formatted = normalizeDynamicToken(renderMergedToolOutput(toolName, args, raw));
  expect(formatted).toBe(normalizeDynamicToken(expected.formatted));
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
        formatted: "• Read alpha.ts, beta.ts",
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
        formatted: "• Read a.ts, b.ts, c.ts, +1",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows inline summary for exactly three unique targets", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const files = ["a.ts", "b.ts", "c.ts"].map((name) => join(workspace, name));
      for (const file of files) await writeFile(file, "export const v = 1;\n", "utf8");

      if (!tools.readFile?.execute) throw new Error("expected readFile tool to be available");
      await tools.readFile.execute({ paths: files.map((path) => ({ path })) }, {} as never);

      assertToolOutput(outputByTool, "read-file", { paths: files.map((path) => ({ path })) }, {
        raw: ["paths=3 targets=[a.ts, b.ts, c.ts]"],
        formatted: "• Read a.ts, b.ts, c.ts",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("deduplicates repeated read targets in summary", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");

      if (!tools.readFile?.execute) throw new Error("expected readFile tool to be available");
      await tools.readFile.execute(
        { paths: [{ path: alphaPath }, { path: alphaPath }, { path: alphaPath, start: 1, end: 1 }] },
        {} as never,
      );

      assertToolOutput(
        outputByTool,
        "read-file",
        { paths: [{ path: alphaPath }, { path: alphaPath }, { path: alphaPath, start: 1, end: 1 }] },
        {
          raw: ["paths=1 targets=[alpha.ts]"],
          formatted: "• Read alpha.ts",
        },
      );
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
          • Find *.ts
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
          "[truncated] +3",
        ],
        formatted: dedent(`
          • Find *.ts
              f1.ts
              f2.ts
              f3.ts
              f4.ts
              f5.ts
              … +3 matches
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("suppresses output rows when no files match", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      await writeFile(join(workspace, "alpha.ts"), "export const alpha = 1;\n", "utf8");

      if (!tools.findFiles?.execute) throw new Error("expected findFiles tool to be available");
      await tools.findFiles.execute({ patterns: ["*.md"], maxResults: 10 }, {} as never);

      assertToolOutput(outputByTool, "find-files", { patterns: ["*.md"], maxResults: 10 }, { raw: [] });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows full body without truncation at file-row boundary", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      for (let i = 1; i <= 5; i += 1) {
        await writeFile(join(workspace, `f${i}.ts`), `export const n${i} = ${i};\n`, "utf8");
      }

      if (!tools.findFiles?.execute) throw new Error("expected findFiles tool to be available");
      await tools.findFiles.execute({ patterns: ["*.ts"], maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "find-files", { patterns: ["*.ts"], maxResults: 20 }, {
        raw: ["scope=workspace patterns=[*.ts] matches=5", "f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts"],
        formatted: dedent(`
          • Find *.ts
              f1.ts
              f2.ts
              f3.ts
              f4.ts
              f5.ts
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("supports multiple patterns in one call with combined matches", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      await writeFile(join(workspace, "alpha.ts"), "export const alpha = 1;\n", "utf8");
      await writeFile(join(workspace, "beta.md"), "# beta\n", "utf8");
      await writeFile(join(workspace, "gamma.ts"), "export const gamma = 1;\n", "utf8");

      if (!tools.findFiles?.execute) throw new Error("expected findFiles tool to be available");
      await tools.findFiles.execute({ patterns: ["*.ts", "*.md"], maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "find-files", { patterns: ["*.ts", "*.md"], maxResults: 20 }, {
        raw: ["scope=workspace patterns=[*.ts, *.md] matches=3", "alpha.ts", "gamma.ts", "beta.md"],
        formatted: dedent(`
          • Find *.ts, *.md
              alpha.ts
              gamma.ts
              beta.md
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
        raw: ["scope=alpha.ts, beta.ts patterns=[needle] matches=2", "alpha.ts [needle@1]", "beta.ts [needle@1]"],
        formatted: dedent(`
          • Search alpha.ts, beta.ts [needle]
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
          • Search [needle]
              alpha.ts [needle@1]
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("uses single-path scope label when one path is provided", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const srcDir = join(workspace, "src");
      const docsDir = join(workspace, "docs");
      await mkdir(srcDir, { recursive: true });
      await mkdir(docsDir, { recursive: true });
      await writeFile(join(srcDir, "alpha.ts"), 'export const alpha = "needle";\n', "utf8");
      await writeFile(join(docsDir, "readme.md"), "needle in docs\n", "utf8");

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns: ["needle"], paths: [srcDir], maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns: ["needle"], paths: [srcDir], maxResults: 20 }, {
        raw: ["scope=src/ patterns=[needle] matches=1", "src/alpha.ts [needle@1]"],
        formatted: dedent(`
          • Search src/ [needle]
              src/alpha.ts [needle@1]
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("uses multi-path scope label when multiple paths are provided", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const srcDir = join(workspace, "src");
      const docsDir = join(workspace, "docs");
      await mkdir(srcDir, { recursive: true });
      await mkdir(docsDir, { recursive: true });
      await writeFile(join(srcDir, "alpha.ts"), 'export const alpha = "needle";\n', "utf8");
      await writeFile(join(docsDir, "readme.md"), "needle in docs\n", "utf8");

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns: ["needle"], paths: [srcDir, docsDir], maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns: ["needle"], paths: [srcDir, docsDir], maxResults: 20 }, {
        raw: ["scope=src/, docs/ patterns=[needle] matches=2", "src/alpha.ts [needle@1]", "docs/readme.md [needle@1]"],
        formatted: dedent(`
          • Search src/, docs/ [needle]
              src/alpha.ts [needle@1]
              docs/readme.md [needle@1]
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("deduplicates repeated patterns in header labels", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      await writeFile(join(workspace, "alpha.ts"), 'export const alpha = "needle";\n', "utf8");

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns: ["needle", "needle", "\\bneedle\\b"], maxResults: 20 }, {} as never);

      assertToolOutput(
        outputByTool,
        "search-files",
        { patterns: ["needle", "needle", "\\bneedle\\b"], maxResults: 20 },
        {
          raw: ["scope=workspace patterns=[needle] matches=1", "alpha.ts [needle@1]"],
          formatted: dedent(`
            • Search [needle]
                alpha.ts [needle@1]
          `),
        },
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("compacts per-file hit lists with +N overflow token", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      await writeFile(join(workspace, "alpha.ts"), "a b c d e f g h i j\n", "utf8");

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns: ["a", "b", "c", "d", "e", "f"], maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns: ["a", "b", "c", "d", "e", "f"], maxResults: 20 }, {
        raw: ["scope=workspace patterns=[a, b, c, d, e, f] matches=1", "alpha.ts [a@1, b@1, c@1, d@1, +2]"],
        formatted: dedent(`
          • Search [a, b, c, +3]
              alpha.ts [a@1, b@1, c@1, d@1, +2]
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("suppresses output rows when there are no content matches", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns: ["nomatch"], maxResults: 10 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns: ["nomatch"], maxResults: 10 }, { raw: [] });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows full body without truncation at file-row boundary for batched needles", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const patterns = ["needle-one", "needle-two", "needle-three", "needle-four", "needle-five"];
      for (let i = 1; i <= 5; i += 1) {
        await writeFile(join(workspace, `f${i}.ts`), `export const value${i} = "${patterns[i - 1]}";\n`, "utf8");
      }

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns, maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns, maxResults: 20 }, {
        raw: [
          "scope=workspace patterns=[needle-one, needle-two, needle-three, needle-four, needle-five] matches=5",
          "f1.ts [needle-one@1]",
          "f2.ts [needle-two@1]",
          "f3.ts [needle-three@1]",
          "f4.ts [needle-four@1]",
          "f5.ts [needle-five@1]",
        ],
        formatted: dedent(`
          • Search [needle-one, needle-two, needle-three, +2]
              f1.ts [needle-one@1]
              f2.ts [needle-two@1]
              f3.ts [needle-three@1]
              f4.ts [needle-four@1]
              f5.ts [needle-five@1]
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("truncates body with marker when matched file rows exceed boundary", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const patterns = ["p1", "p2", "p3", "p4", "p5", "p6"];
      for (let i = 1; i <= 6; i += 1) {
        await writeFile(join(workspace, `f${i}.ts`), `export const value${i} = "${patterns[i - 1]}";\n`, "utf8");
      }

      if (!tools.searchFiles?.execute) throw new Error("expected searchFiles tool to be available");
      await tools.searchFiles.execute({ patterns, maxResults: 20 }, {} as never);

      assertToolOutput(outputByTool, "search-files", { patterns, maxResults: 20 }, {
        raw: [
          "scope=workspace patterns=[p1, p2, p3, p4, p5, p6] matches=6",
          "f1.ts [p1@1]",
          "f2.ts [p2@1]",
          "f3.ts [p3@1]",
          "f4.ts [p4@1]",
          "f5.ts [p5@1]",
          "[truncated] +1",
        ],
        formatted: dedent(`
          • Search [p1, p2, p3, +3]
              f1.ts [p1@1]
              f2.ts [p2@1]
              f3.ts [p3@1]
              f4.ts [p4@1]
              f5.ts [p5@1]
              … +1 match
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
          formatted: "• Review alpha.ts, beta.ts",
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
          formatted: "• Review a.ts, b.ts, c.ts, +1",
        },
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows inline summary for exactly three unique scan targets", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const files = ["a.ts", "b.ts", "c.ts"].map((name) => join(workspace, name));
      for (const file of files) await writeFile(file, "export const value = 1;\n", "utf8");

      if (!tools.scanCode?.execute) throw new Error("expected scanCode tool to be available");
      await tools.scanCode.execute({ paths: files, patterns: ["export const $NAME = $VALUE;"], maxResults: 10 }, {} as never);

      assertToolOutput(
        outputByTool,
        "scan-code",
        { paths: files, patterns: ["export const $NAME = $VALUE;"], maxResults: 10 },
        {
          raw: ["paths=3 targets=[a.ts, b.ts, c.ts]"],
          formatted: "• Review a.ts, b.ts, c.ts",
        },
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("deduplicates repeated scan targets in summary", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      const alphaPath = join(workspace, "alpha.ts");
      await writeFile(alphaPath, 'export const alpha = "needle";\n', "utf8");

      if (!tools.scanCode?.execute) throw new Error("expected scanCode tool to be available");
      await tools.scanCode.execute(
        { paths: [alphaPath, alphaPath, alphaPath], patterns: ["export const $NAME = $VALUE;"], maxResults: 10 },
        {} as never,
      );

      assertToolOutput(
        outputByTool,
        "scan-code",
        { paths: [alphaPath, alphaPath, alphaPath], patterns: ["export const $NAME = $VALUE;"], maxResults: 10 },
        {
          raw: ["paths=1 targets=[alpha.ts]"],
          formatted: "• Review alpha.ts",
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
      await tools.deleteFile.execute({ paths: [path] }, {} as never);

      assertToolOutput(outputByTool, "delete-file", { paths: [path] }, {
        raw: [],
        formatted: "• Delete doomed.txt",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("supports batch delete with concise multi-path header", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      const first = "first.txt";
      const second = "second.txt";
      await writeFile(join(workspace, first), "remove one\n", "utf8");
      await writeFile(join(workspace, second), "remove two\n", "utf8");
      if (!tools.deleteFile?.execute) throw new Error("expected deleteFile tool to be available");
      await tools.deleteFile.execute({ paths: [first, second] }, {} as never);

      assertToolOutput(outputByTool, "delete-file", { paths: [first, second] }, {
        raw: [],
        formatted: "• Delete first.txt, second.txt",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("compacts delete header when deleting more than three files", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      const paths = ["a.txt", "b.txt", "c.txt", "d.txt"];
      for (const path of paths) await writeFile(join(workspace, path), `remove ${path}\n`, "utf8");
      if (!tools.deleteFile?.execute) throw new Error("expected deleteFile tool to be available");
      await tools.deleteFile.execute({ paths }, {} as never);

      assertToolOutput(outputByTool, "delete-file", { paths }, {
        raw: [],
        formatted: "• Delete a.txt, b.txt, c.txt (+1)",
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
      assertToolOutput(outputByTool, "git-status", {}, {
        raw: ["M u1.txt", "M u2.txt", "[truncated] +2 lines", "M u5.txt", "M u6.txt"],
        formatted: dedent(`
          • Git Status
              M u1.txt
              M u2.txt
              … +2 lines
              M u5.txt
              M u6.txt
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows non-truncated body when status output fits preview window", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      setPermissionMode("write");
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      await writeFile(join(workspace, "a.txt"), "a\n", "utf8");
      await writeFile(join(workspace, "b.txt"), "b\n", "utf8");
      await runShellCommand(workspace, "git add .");
      await runShellCommand(workspace, "git commit -m seed");
      await writeFile(join(workspace, "a.txt"), "a changed\n", "utf8");
      await writeFile(join(workspace, "b.txt"), "b changed\n", "utf8");
      setPermissionMode("read");

      if (!tools.gitStatus?.execute) throw new Error("expected gitStatus tool to be available");
      await tools.gitStatus.execute({}, {} as never);

      assertToolOutput(outputByTool, "git-status", {}, {
        raw: ["M a.txt", "M b.txt"],
        formatted: dedent(`
          • Git Status
              M a.txt
              M b.txt
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows no-output body marker when working tree is clean", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      setPermissionMode("write");
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      await writeFile(join(workspace, "tracked.txt"), "x\n", "utf8");
      await runShellCommand(workspace, "git add tracked.txt");
      await runShellCommand(workspace, "git commit -m init");
      setPermissionMode("read");

      if (!tools.gitStatus?.execute) throw new Error("expected gitStatus tool to be available");
      await tools.gitStatus.execute({}, {} as never);

      assertToolOutput(outputByTool, "git-status", {}, {
        raw: ["[no-output]"],
        formatted: dedent(`
          • Git Status
              (No output)
        `),
      });
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
      await writeFile(
        join(workspace, "a.ts"),
        ["export const a = 1;", "export const b = 2;", "export const c = 3;", "export const d = 4;"].join("\n") + "\n",
        "utf8",
      );
      await runShellCommand(workspace, "git add a.ts");
      await runShellCommand(workspace, "git commit -m init");
      await writeFile(
        join(workspace, "a.ts"),
        ["export const a = 10;", "export const b = 20;", "export const c = 30;", "export const d = 40;"].join("\n") + "\n",
        "utf8",
      );
      setPermissionMode("read");

      if (!tools.gitDiff?.execute) throw new Error("expected gitDiff tool to be available");
      await tools.gitDiff.execute({ path: "a.ts", contextLines: 1 }, {} as never);
      assertToolOutput(outputByTool, "git-diff", { path: "a.ts", contextLines: 1 }, {
        raw: [
          "diff --git a/a.ts b/a.ts",
          "index <hash>..<hash> 100644",
          "--- a/a.ts",
          "+++ b/a.ts",
          "[truncated] +5 lines",
          "+export const a = 10;",
          "+export const b = 20;",
          "+export const c = 30;",
          "+export const d = 40;",
        ],
        formatted: dedent(`
          • Git Diff a.ts
              diff --git a/a.ts b/a.ts
              index <hash>..<hash> 100644
              --- a/a.ts
              +++ b/a.ts
              … +5 lines
              +export const a = 10;
              +export const b = 20;
              +export const c = 30;
              +export const d = 40;
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows non-truncated body when diff output fits preview window", async () => {
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
      await tools.gitDiff.execute({ path: "a.ts", contextLines: 0 }, {} as never);

      assertToolOutput(outputByTool, "git-diff", { path: "a.ts", contextLines: 0 }, {
        raw: [
          "diff --git a/a.ts b/a.ts",
          "index <hash>..<hash> 100644",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1 +1 @@",
          "-export const a = 1;",
          "+export const a = 2;",
        ],
        formatted: dedent(`
          • Git Diff a.ts
              diff --git a/a.ts b/a.ts
              index <hash>..<hash> 100644
              --- a/a.ts
              +++ b/a.ts
              @@ -1 +1 @@
              -export const a = 1;
              +export const a = 2;
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows no-output body marker when there are no unstaged changes", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      setPermissionMode("write");
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      await writeFile(join(workspace, "a.ts"), "export const a = 1;\n", "utf8");
      await runShellCommand(workspace, "git add a.ts");
      await runShellCommand(workspace, "git commit -m init");
      setPermissionMode("read");

      if (!tools.gitDiff?.execute) throw new Error("expected gitDiff tool to be available");
      await tools.gitDiff.execute({ path: "a.ts", contextLines: 0 }, {} as never);

      assertToolOutput(outputByTool, "git-diff", { path: "a.ts", contextLines: 0 }, {
        raw: ["[no-output]"],
        formatted: dedent(`
          • Git Diff a.ts
              (No output)
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("tool output contract: git-log", () => {
  test("shows deterministic raw and formatted output", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      setPermissionMode("write");
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      for (let i = 1; i <= 6; i += 1) {
        await writeFile(join(workspace, `c${i}.txt`), `${i}\n`, "utf8");
        await runShellCommand(workspace, `git add c${i}.txt`);
        await runShellCommand(workspace, `git commit -m c${i}`);
      }
      setPermissionMode("read");

      if (!tools.gitLog?.execute) throw new Error("expected gitLog tool to be available");
      await tools.gitLog.execute({ limit: 6 }, {} as never);
      assertToolOutput(outputByTool, "git-log", { limit: 6 }, {
        raw: ["<hash> c6", "<hash> c5", "[truncated] +2 lines", "<hash> c2", "<hash> c1"],
        formatted: dedent(`
          • Git Log
              <hash> c6
              <hash> c5
              … +2 lines
              <hash> c2
              <hash> c1
        `),
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("shows non-truncated body when log output fits preview window", async () => {
    const { workspace, tools, outputByTool } = await createHarness("read");
    try {
      setPermissionMode("write");
      await runShellCommand(workspace, "git init -b main");
      await runShellCommand(workspace, "git config user.email test@example.com");
      await runShellCommand(workspace, "git config user.name Test");
      await writeFile(join(workspace, "a.txt"), "a\n", "utf8");
      await runShellCommand(workspace, "git add a.txt");
      await runShellCommand(workspace, "git commit -m first");
      await writeFile(join(workspace, "b.txt"), "b\n", "utf8");
      await runShellCommand(workspace, "git add b.txt");
      await runShellCommand(workspace, "git commit -m second");
      setPermissionMode("read");

      if (!tools.gitLog?.execute) throw new Error("expected gitLog tool to be available");
      await tools.gitLog.execute({ limit: 2 }, {} as never);
      assertToolOutput(outputByTool, "git-log", { limit: 2 }, {
        raw: ["<hash> second", "<hash> first"],
        formatted: dedent(`
          • Git Log
              <hash> second
              <hash> first
        `),
      });
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

  test("shows full body without truncation at line boundary", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      if (!tools.runCommand?.execute) throw new Error("expected runCommand tool to be available");
      const command = `printf '%s\\n' line1 line2 line3 line4`;
      await tools.runCommand.execute({ command }, {} as never);

      assertToolOutput(outputByTool, "run-command", { command }, {
        raw: ["out | line1", "out | line2", "out | line3", "out | line4"],
        formatted: dedent(`
          • Run printf '%s\\n' line1 line2 line3 line4
              line1
              line2
              line3
              line4
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

  test("compacts multiline command text in run header", async () => {
    const { workspace, tools, outputByTool } = await createHarness("write");
    try {
      if (!tools.runCommand?.execute) throw new Error("expected runCommand tool to be available");
      const command = `printf '%s\\n' line1 line2
printf '%s\\n' line3 line4`;
      await tools.runCommand.execute({ command }, {} as never);

      assertToolOutput(outputByTool, "run-command", { command }, {
        raw: ["out | line1", "out | line2", "out | line3", "out | line4"],
        formatted: dedent(`
          • Run printf '%s\\n' line1 line2 printf '%s\\n' line3 line4
              line1
              line2
              line3
              line4
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

describe("tool output contract: web-search", () => {
  test("renders compacted query in header and URL result rows", () => {
    const outputByTool = new Map<string, string[]>();
    const raw = ['query="bun test" results=1', 'result rank=1 url="https://bun.sh/docs"'];
    outputByTool.set("web-search", raw);

    assertToolOutput(outputByTool, "web-search", { query: "  bun   test  " }, {
      raw,
      formatted: dedent(`
        • Web Search "bun test"
            1. https://bun.sh/docs
      `),
    });
  });

  test("compacts multiline query text into a single header detail", () => {
    const outputByTool = new Map<string, string[]>();
    assertToolOutput(outputByTool, "web-search", { query: "bun\n\n test\n docs" }, {
      raw: [],
      formatted: '• Web Search "bun test docs"',
    });
  });

  test("renders no-results stream rows", () => {
    const outputByTool = new Map<string, string[]>();
    const raw = ['query="missing query" results=0', "[no-output]"];
    outputByTool.set("web-search", raw);

    assertToolOutput(outputByTool, "web-search", { query: "missing query" }, {
      raw,
      formatted: dedent(`
        • Web Search "missing query"
            (No output)
      `),
    });
  });

  test("truncates result rows after five matches", () => {
    const outputByTool = new Map<string, string[]>();
    const raw = [
      'query="acolyte" results=7',
      'result rank=1 url="https://one.test"',
      'result rank=2 url="https://two.test"',
      'result rank=3 url="https://three.test"',
      'result rank=4 url="https://four.test"',
      'result rank=5 url="https://five.test"',
      "[truncated] +2 results",
    ];
    outputByTool.set("web-search", raw);

    assertToolOutput(outputByTool, "web-search", { query: "acolyte" }, {
      raw,
      formatted: dedent(`
        • Web Search "acolyte"
            1. https://one.test
            2. https://two.test
            3. https://three.test
            4. https://four.test
            5. https://five.test
            … +2 results
      `),
    });
  });
});

describe("tool output contract: web-fetch", () => {
  test("shows header-only formatted output", () => {
    const outputByTool = new Map<string, string[]>();
    assertToolOutput(outputByTool, "web-fetch", { url: "https://example.com/docs" }, {
      raw: [],
      formatted: "• Web Fetch https://example.com/docs",
    });
  });
});
