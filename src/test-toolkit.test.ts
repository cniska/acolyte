import { describe, expect, test } from "bun:test";
import { createTestToolkit } from "./test-toolkit";
import { createSessionContext } from "./tool-guards";

type TestResult = { kind: string; command: string; exitCode?: number; output: string };

function createToolkit(testCommand?: { bin: string; args: string[] }) {
  const session = createSessionContext();
  if (testCommand) session.workspaceProfile = { testCommand };
  const output: unknown[] = [];
  const toolkit = createTestToolkit(
    {
      outputBudget: {
        findFiles: { maxChars: 2500, maxLines: 100 },
        searchFiles: { maxChars: 2200, maxLines: 80 },
        webSearch: { maxChars: 2400, maxLines: 80 },
        webFetch: { maxChars: 2600, maxLines: 90 },
        read: { maxChars: 80_000, maxLines: 2000 },
        gitStatus: { maxChars: 1800, maxLines: 80 },
        gitDiff: { maxChars: 3200, maxLines: 120 },
        run: { maxChars: 2600, maxLines: 120 },
        edit: { maxChars: 1400, maxLines: 60 },
        astEdit: { maxChars: 1400, maxLines: 60 },
        scanCode: { maxChars: 2400, maxLines: 80 },
        create: { maxChars: 3000, maxLines: 100 },
      },
    },
    { workspace: process.cwd(), session, onOutput: (e) => output.push(e), onChecklist: () => {} },
  );
  return { toolkit, output };
}

async function runTests(toolkit: ReturnType<typeof createToolkit>["toolkit"], files: string[]): Promise<TestResult> {
  return (await toolkit.runTests.execute({ files }, "call_1")) as TestResult;
}

describe("run-tests tool", () => {
  test("returns error when no test command detected", async () => {
    const { toolkit } = createToolkit();
    const result = await runTests(toolkit, ["src/foo.test.ts"]);
    expect(result.kind).toBe("run-tests");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("No test command");
  });

  test("substitutes $FILES in test command args", async () => {
    const { toolkit } = createToolkit({ bin: "bun", args: ["test", "$FILES"] });
    const result = await runTests(toolkit, ["src/datetime.test.ts"]);
    expect(result.kind).toBe("run-tests");
    expect(result.command).toBe("bun test src/datetime.test.ts");
    expect(result.exitCode).toBe(0);
  });

  test("passes multiple files", async () => {
    const { toolkit } = createToolkit({ bin: "bun", args: ["test", "$FILES"] });
    const result = await runTests(toolkit, ["src/datetime.test.ts", "src/assert.test.ts"]);
    expect(result.command).toBe("bun test src/datetime.test.ts src/assert.test.ts");
    expect(result.exitCode).toBe(0);
  });

  test("reports non-zero exit for failing tests", async () => {
    const { toolkit } = createToolkit({ bin: "bun", args: ["test", "$FILES"] });
    const result = await runTests(toolkit, ["src/nonexistent.test.ts"]);
    expect(result.exitCode).toBe(1);
  });
});
