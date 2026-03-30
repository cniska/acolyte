import { describe, expect, test } from "bun:test";
import { LIFECYCLE_ERROR_CODES, TOOL_ERROR_CODES } from "./error-contract";
import type { GenerateOptions, RunContext } from "./lifecycle-contract";
import { phaseEvaluate, recoveryActionForError } from "./lifecycle-evaluate";
import { createRunContext } from "./test-utils";

describe("recoveryActionForError", () => {
  test("returns none for timeout code (handled by evaluator)", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.timeout, unknownErrorCount: 0 })).toBe("none");
  });

  test("returns stop-unknown-budget for repeated unknown errors", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.unknown, unknownErrorCount: 2 })).toBe(
      "stop-unknown-budget",
    );
  });

  test("returns none for tool-specific multi-match errors", () => {
    expect(recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileMultiMatch, unknownErrorCount: 0 })).toBe(
      "none",
    );
  });
});

describe("phaseEvaluate", () => {
  test("runs effects before evaluators", async () => {
    const events: string[] = [];
    const ctx = createRunContext({
      result: { text: "done", toolCalls: [] },
      debug: (event, fields) => {
        if (event === "lifecycle.eval.decision") {
          events.push(`${String(fields?.effect ?? fields?.evaluator)}:${String(fields?.action)}`);
        }
      },
    });

    await phaseEvaluate(ctx, undefined, {
      shouldYieldNow: () => false,
      effects: [
        { id: "format", run: () => ({ type: "done" }) },
        { id: "lint", run: () => ({ type: "done" }) },
      ],
      evaluators: [
        {
          id: "guard-recovery",
          evaluate: () => ({ action: { type: "regenerate", reason: "guard-recovery" } }),
        },
      ],
      phaseGenerate: async () => {
        ctx.result = undefined;
      },
    });

    expect(events.slice(0, 2)).toEqual(["format:done", "lint:done"]);
    expect(events).toContain("guard-recovery:regenerate");
  });

  test("regenerates from lint effect before running evaluators", async () => {
    const decisions: string[] = [];
    const ctx = createRunContext({
      result: { text: "done", toolCalls: [] },
      debug: (event, fields) => {
        if (event === "lifecycle.eval.decision") {
          decisions.push(`${String(fields?.effect ?? fields?.evaluator)}:${String(fields?.action)}`);
        }
      },
    });

    let generateOptions: GenerateOptions | undefined;
    await phaseEvaluate(ctx, undefined, {
      shouldYieldNow: () => false,
      effects: [
        { id: "format", run: () => ({ type: "done" }) },
        {
          id: "lint",
          run: () => ({
            type: "regenerate",
            reason: "lint",
            feedback: {
              source: "lint",
              summary: "Lint errors detected in files you edited.",
            },
          }),
        },
      ],
      evaluators: [
        {
          id: "guard-recovery",
          evaluate: () => {
            throw new Error("evaluators should not run after command regeneration");
          },
        },
      ],
      phaseGenerate: async (_ctx: RunContext, options: GenerateOptions) => {
        generateOptions = options;
        ctx.result = undefined;
      },
    });

    expect(decisions).toEqual(["format:done", "lint:regenerate"]);
    expect(ctx.lifecycleState.feedback.at(-1)).toEqual({
      source: "lint",
      summary: "Lint errors detected in files you edited.",
    });
    expect(generateOptions).toEqual({ cycleLimit: ctx.policy.initialMaxSteps, timeoutMs: ctx.policy.stepTimeoutMs });
  });

  test("applies evaluator patches centrally", async () => {
    const ctx = createRunContext({
      result: { text: "done", toolCalls: [] },
      currentError: {
        message: "shell-run failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "shell-run",
        source: "tool-error",
      },
      lifecycleState: {
        feedback: [],
        repeatedFailure: {
          signature: "other:tool-error:shell-run:E_COMMAND_FAILED",
          count: 2,
          status: "pending",
        },
      },
    });

    await phaseEvaluate(ctx, undefined, {
      shouldYieldNow: () => false,
      effects: [],
      evaluators: [
        {
          id: "repeated-failure",
          evaluate: () => ({
            action: { type: "done" },
            patch: { repeatedFailureStatus: "surfaced" },
          }),
        },
      ],
      phaseGenerate: async () => {
        throw new Error("phaseGenerate should not run");
      },
    });

    expect(ctx.lifecycleState.repeatedFailure?.status).toBe("surfaced");
  });

  test("stops regeneration when a reason-specific budget is exhausted", async () => {
    const ctx = createRunContext({
      result: { text: "done", toolCalls: [] },
      regenerationCounts: {
        "guard-recovery": 0,
        lint: 0,
        "tool-recovery": 1,
        "repeated-failure": 0,
      },
      policy: {
        ...createRunContext().policy,
        maxRegenerationsPerReason: {
          "guard-recovery": 2,
          lint: 1,
          "tool-recovery": 1,
          "repeated-failure": 1,
        },
      },
      debug: (event, fields) => {
        if (event !== "lifecycle.eval.skipped") return;
        expect(fields?.reason).toBe("regeneration_reason_cap");
        expect(fields?.regeneration_reason).toBe("tool-recovery");
      },
    });

    await phaseEvaluate(ctx, undefined, {
      shouldYieldNow: () => false,
      effects: [],
      evaluators: [
        {
          id: "tool-recovery",
          evaluate: () => ({
            action: {
              type: "regenerate",
              reason: "tool-recovery",
              feedback: { source: "tool-recovery", summary: "Review the changes." },
            },
          }),
        },
      ],
      phaseGenerate: async () => {
        throw new Error("phaseGenerate should not run after the reason budget is exhausted");
      },
    });

    expect(ctx.regenerationLimitHit).toBe(true);
    expect(ctx.regenerationCount).toBe(0);
  });
});
