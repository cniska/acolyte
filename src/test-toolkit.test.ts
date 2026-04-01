import { describe, expect, test } from "bun:test";
import { createTestToolkit } from "./test-toolkit";
import { createToolkitDeps } from "./test-utils";
import { createSessionContext } from "./tool-session";

function createToolkit(testCommand?: { bin: string; args: string[] }) {
  const session = createSessionContext();
  if (testCommand) session.workspaceProfile = { testCommand };
  const output: unknown[] = [];
  const toolkit = createTestToolkit(createToolkitDeps(), {
    workspace: process.cwd(),
    session,
    onOutput: (e) => output.push(e),
    onChecklist: () => {},
  });
  return { toolkit, output };
}

type TestResult = { kind: string; command: string; exitCode?: number; output: string };

async function runTests(toolkit: ReturnType<typeof createToolkit>["toolkit"], files: string[]) {
  const { result } = await toolkit.runTests.execute({ files }, "call_1");
  return result as TestResult;
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
    const { toolkit } = createToolkit({ bin: "bun", args: ["test", "$FILES"] });
    const result = await runTests(toolkit, ["src/datetime.test.ts"]);
    expect(result.kind).toBe("test-run");
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
