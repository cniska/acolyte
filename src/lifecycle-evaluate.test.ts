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
  test("runs lifecycle effects before evaluators", async () => {
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
          evaluate: () => ({ type: "regenerate" }),
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
            feedback: {
              source: "lint",
              mode: "work",
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
    expect(ctx.lifecycleState.feedback.at(-1)?.source).toBe("lint");
    expect(generateOptions).toEqual({ cycleLimit: ctx.policy.initialMaxSteps, timeoutMs: ctx.policy.stepTimeoutMs });
  });
});
