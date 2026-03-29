import { describe, expect, test } from "bun:test";
import { runFormatIfConfigured, runLintIfConfigured } from "./lifecycle-effects";
import { createRunContext } from "./test-utils";

describe("runFormatIfConfigured", () => {
  test("runs format for written files in work mode", () => {
    const calls: Array<{ workspace: string; filePaths: string[] }> = [];
    const ctx = createRunContext({
      mode: "work",
      workspace: "/tmp/test",
      taskId: "task_format",
      policy: {
        ...createRunContext().policy,
        formatCommand: { bin: "bunx", args: ["biome", "check", "--write"] },
      },
      session: {
        ...createRunContext().session,
        callLog: [
          { toolName: "file-edit", args: { path: "src/a.ts" }, taskId: "task_format", status: "succeeded" },
          { toolName: "code-edit", args: { path: "src/b.ts" }, taskId: "task_format", status: "succeeded" },
        ],
      },
    });

    expect(
      runFormatIfConfigured(ctx, (workspace, _command, filePaths) => {
        calls.push({ workspace, filePaths });
        return { hasErrors: false, stdout: "", stderr: "" };
      }),
    ).toEqual({ type: "done" });
    expect(calls).toEqual([{ workspace: "/tmp/test", filePaths: ["src/a.ts", "src/b.ts"] }]);
  });

  test("skips when no files were written", () => {
    const ctx = createRunContext({
      mode: "work",
      workspace: "/tmp/test",
      taskId: "task_format",
      policy: {
        ...createRunContext().policy,
        formatCommand: { bin: "bunx", args: ["biome", "check", "--write"] },
      },
    });

    let called = false;
    expect(
      runFormatIfConfigured(ctx, () => {
        called = true;
        return { hasErrors: false, stdout: "", stderr: "" };
      }),
    ).toEqual({ type: "done" });
    expect(called).toBe(false);
  });
});

describe("runLintIfConfigured", () => {
  test("returns regenerate with lint feedback on errors", () => {
    const ctx = createRunContext({
      mode: "work",
      workspace: "/tmp/test",
      taskId: "task_lint",
      policy: {
        ...createRunContext().policy,
        lintCommand: { bin: "bunx", args: ["biome", "check"] },
      },
      session: {
        ...createRunContext().session,
        callLog: [{ toolName: "file-edit", args: { path: "src/a.ts" }, taskId: "task_lint", status: "succeeded" }],
      },
    });

    const action = runLintIfConfigured(ctx, () => ({
      hasErrors: true,
      stdout: "src/a.ts:1:1 lint error",
      stderr: "",
    }));

    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("lint");
      expect(action.feedback?.summary).toBe("Lint errors detected in files you edited.");
      expect(action.feedback?.details).toContain("src/a.ts:1:1 lint error");
    }
  });

  test("returns done when lint passes", () => {
    const ctx = createRunContext({
      mode: "work",
      workspace: "/tmp/test",
      taskId: "task_lint",
      policy: {
        ...createRunContext().policy,
        lintCommand: { bin: "bunx", args: ["biome", "check"] },
      },
      session: {
        ...createRunContext().session,
        callLog: [{ toolName: "file-edit", args: { path: "src/a.ts" }, taskId: "task_lint", status: "succeeded" }],
      },
    });

    expect(runLintIfConfigured(ctx, () => ({ hasErrors: false, stdout: "", stderr: "" }))).toEqual({ type: "done" });
  });
});
