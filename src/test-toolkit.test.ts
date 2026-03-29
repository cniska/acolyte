import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestToolkit } from "./test-toolkit";
import { createToolkitDeps, tempDir } from "./test-utils";
import { createSessionContext } from "./tool-guards";

type TestResult = { kind: string; command: string; exitCode?: number; output: string };

const PASSING_TEST = 'import { expect, test } from "bun:test";\ntest("ok", () => {\n  expect(1).toBe(1);\n});\n';

const { createDir, cleanupDirs } = tempDir();

afterEach(() => {
  cleanupDirs();
});

function writeWorkspaceFile(workspace: string, path: string, content: string): void {
  const filePath = join(workspace, path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createToolkit(options?: {
  workspace?: string;
  testCommand?: { bin: string; args: string[] };
  ecosystem?: string;
}) {
  const session = createSessionContext();
  if (options?.testCommand)
    session.workspaceProfile = { testCommand: options.testCommand, ecosystem: options.ecosystem };
  const output: unknown[] = [];
  const toolkit = createTestToolkit(createToolkitDeps(), {
    workspace: options?.workspace ?? process.cwd(),
    session,
    onOutput: (e) => output.push(e),
    onChecklist: () => {},
  });
  return { toolkit, output, session };
}

async function runTests(toolkit: ReturnType<typeof createToolkit>["toolkit"], files: string[]): Promise<TestResult> {
  return (await toolkit.runTests.execute({ files }, "call_1")) as TestResult;
}

describe("test-run tool", () => {
  test("returns error when no test command detected", async () => {
    const { toolkit } = createToolkit();
    const result = await runTests(toolkit, ["src/foo.test.ts"]);
    expect(result.kind).toBe("test-run");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("No test command");
  });

  test("substitutes $FILES in test command args", async () => {
    const { toolkit } = createToolkit({ testCommand: { bin: "bun", args: ["test", "$FILES"] } });
    const result = await runTests(toolkit, ["src/datetime.test.ts"]);
    expect(result.kind).toBe("test-run");
    expect(result.command).toBe("bun test src/datetime.test.ts");
    expect(result.exitCode).toBe(0);
  });

  test("passes multiple files", async () => {
    const { toolkit } = createToolkit({ testCommand: { bin: "bun", args: ["test", "$FILES"] } });
    const result = await runTests(toolkit, ["src/datetime.test.ts", "src/assert.test.ts"]);
    expect(result.command).toBe("bun test src/datetime.test.ts src/assert.test.ts");
    expect(result.exitCode).toBe(0);
  });

  test("reports non-zero exit for failing tests", async () => {
    const { toolkit } = createToolkit({ testCommand: { bin: "bun", args: ["test", "$FILES"] } });
    const result = await runTests(toolkit, ["src/nonexistent.test.ts"]);
    expect(result.exitCode).toBe(1);
  });

  test("resolves direct counterpart test files from source inputs", async () => {
    const workspace = createDir("acolyte-test-run-");
    writeWorkspaceFile(workspace, "src/foo.ts", "export const foo = 1;\n");
    writeWorkspaceFile(workspace, "src/foo.test.ts", PASSING_TEST);

    const { toolkit, session } = createToolkit({
      workspace,
      testCommand: { bin: "bun", args: ["test", "$FILES"] },
      ecosystem: "typescript",
    });
    const result = await runTests(toolkit, ["src/foo.ts"]);

    expect(result.command).toBe("bun test src/foo.test.ts");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Resolved direct counterpart tests: src/foo.ts -> src/foo.test.ts");
    expect(session.callLog.at(-1)?.args).toEqual({ files: ["src/foo.test.ts"] });
  });

  test("skips unresolved source files when other counterpart tests exist", async () => {
    const workspace = createDir("acolyte-test-run-");
    writeWorkspaceFile(workspace, "src/foo.ts", "export const foo = 1;\n");
    writeWorkspaceFile(workspace, "src/bar.ts", "export const bar = 2;\n");
    writeWorkspaceFile(workspace, "src/foo.test.ts", PASSING_TEST);

    const { toolkit } = createToolkit({
      workspace,
      testCommand: { bin: "bun", args: ["test", "$FILES"] },
      ecosystem: "typescript",
    });
    const result = await runTests(toolkit, ["src/foo.ts", "src/bar.ts"]);

    expect(result.command).toBe("bun test src/foo.test.ts");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("No direct counterpart test file found for: src/bar.ts");
  });

  test("returns an error when no direct counterpart test files exist", async () => {
    const workspace = createDir("acolyte-test-run-");
    writeWorkspaceFile(workspace, "src/foo.ts", "export const foo = 1;\n");

    const { toolkit } = createToolkit({
      workspace,
      testCommand: { bin: "bun", args: ["test", "$FILES"] },
      ecosystem: "typescript",
    });
    const result = await runTests(toolkit, ["src/foo.ts"]);

    expect(result.command).toBe("");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("No direct counterpart test file found for: src/foo.ts");
  });
});
