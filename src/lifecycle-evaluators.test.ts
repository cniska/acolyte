import { describe, expect, test } from "bun:test";
import { TOOL_ERROR_CODES } from "./error-contract";
import {
  guardRecoveryEvaluator,
  repeatedFailureEvaluator,
  toolRecoveryEvaluator,
  verifyCycleEvaluator,
} from "./lifecycle-evaluators";
import { updateRepeatedFailureState } from "./lifecycle-state";
import { createRunContext } from "./test-utils";
import { createSessionContext, recordCall } from "./tool-guards";

describe("verifyCycleEvaluator", () => {
  test("declares work and verify applicability", () => {
    expect(verifyCycleEvaluator.modes).toEqual(["work", "verify"]);
  });

  test("enters verify mode when write tools used", () => {
    const ctx = createRunContext({
      initialMode: "work",
      workspace: "/tmp/test",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["file-edit"]),
    });
    const action = verifyCycleEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("verify");
    }
  });

  test("returns done when request disables verification", () => {
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "fix", history: [], verifyScope: "none" },
      initialMode: "work",
      workspace: "/tmp/test",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["file-edit"]),
    });
    expect(verifyCycleEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done when verify already ran", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "shell-run", { command: "bun run verify" });
    const ctx = createRunContext({
      initialMode: "work",
      session,
      workspace: "/tmp/test",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["file-edit"]),
    });
    expect(verifyCycleEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no write tools used", () => {
    const ctx = createRunContext({
      initialMode: "work",
      workspace: "/tmp/test",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["file-read", "file-search"]),
    });
    expect(verifyCycleEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no result", () => {
    const ctx = createRunContext({ result: undefined });
    expect(verifyCycleEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done in verify mode when review is clean", () => {
    const ctx = createRunContext({
      mode: "verify",
      result: { text: "Updated x.", toolCalls: [], signal: "done" },
      lifecycleState: {
        feedback: [],
        reviewCandidate: undefined,
        reviewResult: { status: "clean" },
        repeatedFailure: undefined,
      },
    });
    expect(verifyCycleEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });

  test("returns regenerate to work when review finds issues", () => {
    const ctx = createRunContext({
      mode: "verify",
      result: { text: "Updated x.", toolCalls: [], signal: "done" },
      lifecycleState: {
        feedback: [],
        reviewCandidate: undefined,
        reviewResult: {
          status: "issues",
          details: "Missing null check in src/a.ts.",
        },
        repeatedFailure: undefined,
      },
    });
    expect(verifyCycleEvaluator.evaluate(ctx)).toEqual({
      type: "regenerate",
      reason: "verify",
      feedback: {
        source: "verify",
        summary: "Code review found issues to fix.",
        details: "Missing null check in src/a.ts.",
        instruction: "Fix the review findings, then continue.",
      },
      mode: "work",
    });
  });

  test("returns done in verify mode when review is blocked", () => {
    const ctx = createRunContext({
      mode: "verify",
      result: { text: "Need generated types to review this safely.", toolCalls: [], signal: "blocked" },
      lifecycleState: {
        feedback: [],
        reviewCandidate: undefined,
        reviewResult: {
          status: "blocked",
          details: "Need generated types to review this safely.",
        },
        repeatedFailure: undefined,
      },
    });
    expect(verifyCycleEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });
});

describe("guardRecoveryEvaluator", () => {
  test("returns regenerate when guard-blocked error has pending guard feedback", () => {
    const ctx = createRunContext({
      currentError: { message: "Duplicate file-read call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
      lifecycleState: {
        feedback: [
          {
            source: "guard",
            mode: "work",
            summary: "The previous file-read call already used these arguments.",
            instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
          },
        ],
        reviewCandidate: undefined,
        reviewResult: undefined,
      },
    });

    expect(guardRecoveryEvaluator.evaluate(ctx)).toEqual({ type: "regenerate", reason: "guard-recovery" });
  });

  test("returns done when no pending guard feedback exists", () => {
    const ctx = createRunContext({
      currentError: { message: "Duplicate file-read call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
    });

    expect(guardRecoveryEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });
});

describe("repeatedFailureEvaluator", () => {
  test("returns regenerate when the same non-guard failure repeats", () => {
    const ctx = createRunContext({
      currentError: {
        message: "shell-run failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "shell-run",
        source: "tool-error",
      },
      result: { text: "Attempted fix.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        reviewCandidate: undefined,
        reviewResult: undefined,
        repeatedFailure: {
          signature: "other:tool-error:shell-run:E_COMMAND_FAILED",
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
      currentError: { message: "Duplicate file-read call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        reviewCandidate: undefined,
        reviewResult: undefined,
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
        message: "shell-run failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "shell-run",
        source: "tool-error",
      },
      result: { text: "Attempted fix.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        reviewCandidate: undefined,
        reviewResult: undefined,
        repeatedFailure: {
          signature: "other:tool-error:shell-run:E_COMMAND_FAILED",
          count: 3,
          status: "surfaced",
        },
      },
    });

    expect(repeatedFailureEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });

  test("tracks different shell-run failures as different repeated-failure streaks", () => {
    const session = createSessionContext("task_repeat");
    recordCall(session, "shell-run", { command: "bun test src/a.test.ts" });

    const ctx = createRunContext({
      taskId: "task_repeat",
      session,
      currentError: {
        message: "shell-run failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "shell-run",
        source: "tool-error",
      },
    });

    updateRepeatedFailureState(ctx);
    expect(ctx.lifecycleState.repeatedFailure?.count).toBe(1);

    recordCall(session, "shell-run", { command: "bun test src/b.test.ts" });
    updateRepeatedFailureState(ctx);
    expect(ctx.lifecycleState.repeatedFailure?.count).toBe(1);
    expect(ctx.lifecycleState.repeatedFailure?.signature).toContain("src/b.test.ts");
  });
});

describe("toolRecoveryEvaluator", () => {
  test("returns regenerate when file-edit exposes structured recovery", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "file-edit", args: { path: "src/priority.ts" }, status: "failed" }];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      session,
      observedTools: new Set(["file-read", "file-edit"]),
      currentError: {
        code: "E_EDIT_FILE_MULTI_MATCH",
        message: "file-edit failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations (foo…).",
        tool: "file-edit",
        recovery: {
          tool: "file-edit",
          kind: "disambiguate-match",
          summary: "Your file-edit snippet matched multiple locations.",
          instruction: "Keep the change in 'src/priority.ts' and make one bounded edit with a more unique snippet.",
        },
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("Your file-edit snippet matched multiple locations.");
      expect(action.feedback?.details).toContain("Find text matched 3 locations");
      expect(action.feedback?.instruction).toContain("src/priority.ts");
    }
  });

  test("returns regenerate when code-edit exposes structured recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.editCodeNoMatch,
        tool: "code-edit",
        message: "code-edit failed: [E_EDIT_CODE_NO_MATCH] No AST matches found for pattern: return $VALUE",
        recovery: {
          tool: "code-edit",
          kind: "refine-pattern",
          summary: "Your AST pattern did not match the current file.",
          instruction: "Refine the pattern against the latest file syntax.",
          nextTool: "file-read",
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
      expect(action.feedback?.details).toContain("Suggested next tool: file-read");
      expect(action.feedback?.details).toContain("Suggested paths: src/code-ops.ts");
      expect(action.feedback?.instruction).toContain("Refine the pattern");
    }
  });

  test("returns regenerate when code-edit rename target is ambiguous", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.editCodeNoMatch,
        tool: "code-edit",
        message:
          'code-edit failed: [E_EDIT_CODE_NO_MATCH] Scoped rename target is ambiguous for alias; retry with target: "local" or target: "member" withinSymbol: ProviderConfig',
        recovery: {
          tool: "code-edit",
          kind: "clarify-rename-target",
          summary: "This scoped rename matches both local and member symbols.",
          instruction: 'Retry the rename with target: "local" or target: "member".',
          nextTool: "code-edit",
          targetPaths: ["src/provider-config.ts"],
        },
      },
      result: { text: "Attempted rename.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("This scoped rename matches both local and member symbols.");
      expect(action.feedback?.details).toContain('target: "local"');
      expect(action.feedback?.details).toContain("Suggested next tool: code-edit");
      expect(action.feedback?.details).toContain("Suggested paths: src/provider-config.ts");
      expect(action.feedback?.instruction).toContain('target: "member"');
    }
  });

  test("returns regenerate when code-scan exposes structured recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.scanCodeUnsupportedFile,
        tool: "code-scan",
        message:
          "code-scan failed: [E_SCAN_CODE_UNSUPPORTED_FILE] code-scan requires a supported code file, got: notes.yaml",
        recovery: {
          tool: "code-scan",
          kind: "use-supported-file",
          summary: "code-scan only works on supported code files.",
          instruction: "Use code-scan on a supported code file or directory, or switch to file-search.",
          nextTool: "file-search",
          targetPaths: ["notes.yaml"],
        },
      },
      result: { text: "Attempted scan.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("code-scan only works on supported code files.");
      expect(action.feedback?.details).toContain("notes.yaml");
      expect(action.feedback?.details).toContain("Suggested next tool: file-search");
      expect(action.feedback?.details).toContain("Suggested paths: notes.yaml");
      expect(action.feedback?.instruction).toContain("file-search");
    }
  });

  test("declares work-only applicability", () => {
    expect(toolRecoveryEvaluator.modes).toEqual(["work"]);
  });

  test("returns regenerate when file-search empty-scope exposes structured recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.searchFilesEmptyScope,
        tool: "file-search",
        message: "file-search failed: [E_SEARCH_FILES_EMPTY_SCOPE] file-search scope resolved to no files: src/missing",
        recovery: {
          tool: "file-search",
          kind: "broaden-scope",
          summary: "Your file-search scope resolved to no searchable files.",
          instruction: "Broaden the scope or use file-find to locate the target file before searching again.",
          nextTool: "file-find",
        },
      },
      result: { text: "Attempted search.", toolCalls: [] },
    });

    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("Your file-search scope resolved to no searchable files.");
      expect(action.feedback?.details).toContain("E_SEARCH_FILES_EMPTY_SCOPE");
      expect(action.feedback?.details).toContain("Suggested next tool: file-find");
      expect(action.feedback?.instruction).toContain("file-find");
    }
  });

  test("returns regenerate when file-search no-match exposes structured recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.searchFilesNoMatch,
        tool: "file-search",
        message:
          "file-search failed: [E_SEARCH_FILES_NO_MATCH] file-search found no matches in scoped file: src/provider-config.ts",
        recovery: {
          tool: "file-search",
          kind: "switch-to-read",
          summary: "Your file-search query found no matches in the scoped file.",
          instruction: "Switch to file-read and inspect the file directly.",
          nextTool: "file-read",
          targetPaths: ["src/provider-config.ts"],
        },
      },
      result: { text: "Attempted search.", toolCalls: [] },
    });

    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("tool-recovery");
      expect(action.feedback?.summary).toBe("Your file-search query found no matches in the scoped file.");
      expect(action.feedback?.details).toContain("E_SEARCH_FILES_NO_MATCH");
      expect(action.feedback?.details).toContain("Suggested next tool: file-read");
      expect(action.feedback?.details).toContain("Suggested paths: src/provider-config.ts");
      expect(action.feedback?.instruction).toContain("file-read");
    }
  });

  test("returns done when there is no structured tool recovery", () => {
    const ctx = createRunContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.editFileFindTooLarge,
        tool: "file-edit",
        message: "file-edit failed: find must be a short unique snippet",
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    expect(toolRecoveryEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done after a later successful write for disambiguate-match recovery", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit", "code-edit"]);
    session.callLog = [
      { toolName: "file-edit", args: { path: "src/priority.ts" }, status: "failed" },
      { toolName: "file-edit", args: { path: "src/priority.ts" }, status: "succeeded" },
    ];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      session,
      currentError: {
        tool: "file-edit",
        message: "file-edit failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations.",
        recovery: {
          tool: "file-edit",
          kind: "disambiguate-match",
          summary: "Your file-edit snippet matched multiple locations.",
          instruction: "Use a more unique snippet.",
        },
      },
      result: { text: "Applied the change.", toolCalls: [] },
    });
    expect(toolRecoveryEvaluator.evaluate(ctx).type).toBe("done");
  });
});
