import { describe, expect, test } from "bun:test";
import { TOOL_ERROR_CODES } from "./error-contract";
import {
  guardRecoveryEvaluator,
  repeatedFailureEvaluator,
  toolRecoveryEvaluator,
  verifyCycle,
} from "./lifecycle-evaluators";
import { updateRepeatedFailureState } from "./lifecycle-state";
import { createRunContext } from "./test-utils";
import { createSessionContext, recordCall } from "./tool-guards";

describe("verifyCycle", () => {
  test("returns regenerate when write tools used without verify", () => {
    const session = createSessionContext("task_new");
    session.callLog = [
      { toolName: "edit-file", args: { path: "src/old.ts" }, taskId: "task_old", status: "succeeded" },
      { toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] }, taskId: "task_new", status: "succeeded" },
      { toolName: "read-file", args: { paths: [{ path: "src/c.ts" }] }, taskId: "task_new", status: "succeeded" },
      {
        toolName: "scan-code",
        args: { paths: ["src/d.ts"], patterns: ["export function $NAME"] },
        taskId: "task_new",
        status: "succeeded",
      },
      { toolName: "edit-file", args: { path: "src/a.ts" }, taskId: "task_new", status: "succeeded" },
      { toolName: "edit-code", args: { path: "src/b.ts" }, taskId: "task_new", status: "succeeded" },
    ];
    const ctx = createRunContext({
      initialMode: "work",
      taskId: "task_new",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "edit-file"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("verify");
      expect(action.keepResult).toBe(true);
      expect(action.feedback?.details).toContain("Task boundary:");
      expect(action.feedback?.details).toContain("- src/a.ts");
      expect(action.feedback?.details).toContain("- src/b.ts");
      expect(action.feedback?.details).toContain("Allowed supporting reads");
      expect(action.feedback?.details).toContain("- src/c.ts");
      expect(action.feedback?.details).toContain("- src/d.ts");
      expect(action.feedback?.details).not.toContain("- src/old.ts");
    }
  });

  test("uses base verify prompt when no write paths are available", () => {
    const ctx = createRunContext({
      initialMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.feedback?.details).not.toContain("Task boundary:");
  });

  test("uses global verify prompt when request explicitly opts into global scope", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/a.ts" }, status: "succeeded" }];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Implement fix", history: [], verifyScope: "global" },
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.feedback?.details).not.toContain("Task boundary:");
  });

  test("returns done when request disables verification", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/a.ts" }, status: "succeeded" }];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Implement fix", history: [], verifyScope: "none" },
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns done when verify already ran", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createRunContext({
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no write tools used", () => {
    const ctx = createRunContext({
      initialMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "search-files"]),
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no result", () => {
    const ctx = createRunContext({ result: undefined });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns regenerate to work mode when verify reports issues", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createRunContext({
      mode: "verify",
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: {
          text: "Error: missing export updatePost in post-store.ts",
          error: { message: "verify failed: missing export updatePost in post-store.ts" },
        },
      },
      observedTools: new Set(["scan-code"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("work");
      expect(action.feedback?.details).toContain("missing export updatePost");
    }
  });

  test("returns done when in verify mode without errors", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createRunContext({
      mode: "verify",
      initialMode: "work",
      session,
      result: { text: "", toolCalls: [] },
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("ignores restored work result when verify outcome is missing", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createRunContext({
      mode: "verify",
      initialMode: "work",
      session,
      currentError: undefined,
      result: { text: "Done.", toolCalls: [] },
      lifecycleState: { feedback: [], verifyOutcome: undefined },
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns done for explicit no-issue verification summaries", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createRunContext({
      mode: "verify",
      initialMode: "work",
      session,
      result: { text: "No issues found. 0 errors.", toolCalls: [] },
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });
});

describe("guardRecoveryEvaluator", () => {
  test("returns regenerate when guard-blocked error has pending guard feedback", () => {
    const ctx = createRunContext({
      currentError: { message: "Duplicate read-file call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
      lifecycleState: {
        feedback: [
          {
            source: "guard",
            mode: "work",
            summary: "The previous read-file call already used these arguments.",
            instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
          },
        ],
        verifyOutcome: undefined,
      },
    });

    expect(guardRecoveryEvaluator.evaluate(ctx)).toEqual({ type: "regenerate" });
  });

  test("returns done when no pending guard feedback exists", () => {
    const ctx = createRunContext({
      currentError: { message: "Duplicate read-file call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
    });

    expect(guardRecoveryEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });
});

describe("repeatedFailureEvaluator", () => {
  test("returns regenerate when the same non-guard failure repeats", () => {
    const ctx = createRunContext({
      currentError: {
        message: "run-command failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "run-command",
        source: "tool-error",
      },
      result: { text: "Attempted fix.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: undefined,
        repeatedFailure: {
          signature: "other:tool-error:run-command:E_COMMAND_FAILED",
          count: 2,
          status: "pending",
        },
      },
    });

    const action = repeatedFailureEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.summary).toBe("The same runtime failure has repeated.");
      expect(action.feedback?.details).toContain("command exited with code 1");
      expect(action.feedback?.instruction).toContain("Change approach");
    }
    expect(ctx.lifecycleState.repeatedFailure?.status).toBe("surfaced");
  });

  test("returns done for repeated guard-blocked failures", () => {
    const ctx = createRunContext({
      currentError: { message: "Duplicate read-file call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: undefined,
        repeatedFailure: {
          signature: "guard-blocked:tool-error:none:E_GUARD_BLOCKED",
          count: 2,
          status: "pending",
        },
      },
    });

    expect(repeatedFailureEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });

  test("returns done after the repeated failure streak was already surfaced", () => {
    const ctx = createRunContext({
      currentError: {
        message: "run-command failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "run-command",
        source: "tool-error",
      },
      result: { text: "Attempted fix.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: undefined,
        repeatedFailure: {
          signature: "other:tool-error:run-command:E_COMMAND_FAILED",
          count: 3,
          status: "surfaced",
        },
      },
    });

    expect(repeatedFailureEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });

  test("tracks different run-command failures as different repeated-failure streaks", () => {
    const session = createSessionContext("task_repeat");
    recordCall(session, "run-command", { command: "bun test src/a.test.ts" });

    const ctx = createRunContext({
      taskId: "task_repeat",
      session,
      currentError: {
        message: "run-command failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "run-command",
        source: "tool-error",
      },
    });

    updateRepeatedFailureState(ctx);
    expect(ctx.lifecycleState.repeatedFailure?.count).toBe(1);

    recordCall(session, "run-command", { command: "bun test src/b.test.ts" });
    updateRepeatedFailureState(ctx);
    expect(ctx.lifecycleState.repeatedFailure?.count).toBe(1);
    expect(ctx.lifecycleState.repeatedFailure?.signature).toContain("src/b.test.ts");
  });
});

describe("toolRecoveryEvaluator", () => {
  test("returns regenerate when edit-file exposes structured recovery", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/priority.ts" }, status: "failed" }];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      session,
      observedTools: new Set(["read-file", "edit-file"]),
      currentError: {
        code: "E_EDIT_FILE_MULTI_MATCH",
        message: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations (foo…).",
        tool: "edit-file",
        recovery: {
          tool: "edit-file",
          kind: "disambiguate-match",
          summary: "Your edit-file snippet matched multiple locations.",
          instruction: "Keep the change in 'src/priority.ts' and make one bounded edit with a more unique snippet.",
        },
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("Your edit-file snippet matched multiple locations.");
      expect(action.feedback?.details).toContain("Find text matched 3 locations");
      expect(action.feedback?.instruction).toContain("src/priority.ts");
    }
  });

  test("returns regenerate when edit-code exposes structured recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.editCodeNoMatch,
        tool: "edit-code",
        message: "edit-code failed: [E_EDIT_CODE_NO_MATCH] No AST matches found for pattern: return $VALUE",
        recovery: {
          tool: "edit-code",
          kind: "refine-pattern",
          summary: "Your AST pattern did not match the current file.",
          instruction: "Refine the pattern against the latest file syntax.",
          nextTool: "read-file",
          targetPaths: ["src/code-ops.ts"],
        },
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("Your AST pattern did not match the current file.");
      expect(action.feedback?.details).toContain("No AST matches found");
      expect(action.feedback?.details).toContain("Suggested next tool: read-file");
      expect(action.feedback?.details).toContain("Suggested paths: src/code-ops.ts");
      expect(action.feedback?.instruction).toContain("Refine the pattern");
    }
  });

  test("returns regenerate when scan-code exposes structured recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.scanCodeUnsupportedFile,
        tool: "scan-code",
        message:
          "scan-code failed: [E_SCAN_CODE_UNSUPPORTED_FILE] scan-code requires a supported code file, got: notes.yaml",
        recovery: {
          tool: "scan-code",
          kind: "use-supported-file",
          summary: "scan-code only works on supported code files.",
          instruction: "Use scan-code on a supported code file or directory, or switch to search-files.",
          nextTool: "search-files",
          targetPaths: ["notes.yaml"],
        },
      },
      result: { text: "Attempted scan.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("scan-code only works on supported code files.");
      expect(action.feedback?.details).toContain("notes.yaml");
      expect(action.feedback?.details).toContain("Suggested next tool: search-files");
      expect(action.feedback?.details).toContain("Suggested paths: notes.yaml");
      expect(action.feedback?.instruction).toContain("search-files");
    }
  });

  test("returns done for structured recovery while active mode is verify", () => {
    const ctx = createRunContext({
      mode: "verify",
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.scanCodeUnsupportedFile,
        tool: "scan-code",
        message:
          "scan-code failed: [E_SCAN_CODE_UNSUPPORTED_FILE] scan-code requires a supported code file, got: notes.yaml",
        recovery: {
          tool: "scan-code",
          kind: "use-supported-file",
          summary: "scan-code only works on supported code files.",
          instruction: "Use search-files for plain-text lookup.",
          nextTool: "search-files",
          targetPaths: ["notes.yaml"],
        },
      },
      result: { text: "Attempted verify scan.", toolCalls: [] },
    });
    expect(toolRecoveryEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done when there is no structured tool recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.editFileFindTooLarge,
        tool: "edit-file",
        message: "edit-file failed: find must be a short unique snippet",
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    expect(toolRecoveryEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done after a later successful write for disambiguate-match recovery", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file", "edit-code"]);
    session.callLog = [
      { toolName: "edit-file", args: { path: "src/priority.ts" }, status: "failed" },
      { toolName: "edit-file", args: { path: "src/priority.ts" }, status: "succeeded" },
    ];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      session,
      currentError: {
        tool: "edit-file",
        message: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations.",
        recovery: {
          tool: "edit-file",
          kind: "disambiguate-match",
          summary: "Your edit-file snippet matched multiple locations.",
          instruction: "Use a more unique snippet.",
        },
      },
      result: { text: "Applied the change.", toolCalls: [] },
    });
    expect(toolRecoveryEvaluator.evaluate(ctx).type).toBe("done");
  });
});
