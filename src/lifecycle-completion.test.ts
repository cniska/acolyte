import { describe, expect, test } from "bun:test";
import { findCompletionBlock } from "./lifecycle-completion";
import type { ToolCallRecord } from "./tool-session";

const writeToolSet = new Set(["file-edit", "file-create"]);
const runnerToolSet = new Set(["shell-run", "test-run"]);

function record(toolName: string, args: Record<string, unknown>, status: "succeeded" | "failed" = "succeeded") {
  return { toolName, args, status } satisfies ToolCallRecord;
}

describe("findCompletionBlock", () => {
  test("blocks done after a source write without later validation", () => {
    const block = findCompletionBlock({
      signal: "done",
      callLog: [record("file-edit", { path: "src/app.ts" })],
      writeToolSet,
      runnerToolSet,
    });

    expect(block).toEqual({
      reason: "missing-validation-after-write",
      path: "src/app.ts",
      message:
        "Cannot finish yet: `src/app.ts` changed after the last successful validation. Run focused validation, or say why validation is blocked.",
    });
  });

  test("allows done when a successful runner follows the last source write", () => {
    const block = findCompletionBlock({
      signal: "done",
      callLog: [
        record("file-edit", { path: "src/app.ts" }),
        { ...record("test-run", { command: "bun test src/app.test.ts" }), exitCode: 0 },
      ],
      writeToolSet,
      runnerToolSet,
    });

    expect(block).toBeUndefined();
  });

  test("blocks done when validation happened before the last source write", () => {
    const block = findCompletionBlock({
      signal: "done",
      callLog: [
        { ...record("test-run", { command: "bun test src/app.test.ts" }), exitCode: 0 },
        record("file-edit", { path: "src/app.ts" }),
      ],
      writeToolSet,
      runnerToolSet,
    });

    expect(block?.reason).toBe("missing-validation-after-write");
  });

  test("ignores non-source writes and non-done signals", () => {
    expect(
      findCompletionBlock({
        signal: "done",
        callLog: [record("file-edit", { path: "docs/readme.md" })],
        writeToolSet,
        runnerToolSet,
      }),
    ).toBeUndefined();

    expect(
      findCompletionBlock({
        signal: "blocked",
        callLog: [record("file-edit", { path: "src/app.ts" })],
        writeToolSet,
        runnerToolSet,
      }),
    ).toBeUndefined();
  });
});
