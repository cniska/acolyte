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
        { id: "format", modes: ["work"], run: () => ({ type: "done" }) },
        { id: "lint", modes: ["work"], run: () => ({ type: "done" }) },
      ],
      evaluators: [
        {
          id: "guard-recovery",
          modes: ["work"],
          evaluate: () => ({ type: "regenerate", reason: "guard-recovery" }),
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
        { id: "format", modes: ["work"], run: () => ({ type: "done" }) },
        {
          id: "lint",
          modes: ["work"],
          run: () => ({
            type: "regenerate",
            reason: "lint",
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
          modes: ["work"],
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

  test("skips effects and evaluators whose modes do not include the active mode", async () => {
    const events: string[] = [];
    const ctx = createRunContext({
      mode: "verify",
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
        {
          id: "work-only-effect",
          modes: ["work"],
          run: () => {
            throw new Error("work-only effect should be skipped in verify mode");
          },
        },
      ],
      evaluators: [
        {
          id: "work-only-evaluator",
          modes: ["work"],
          evaluate: () => {
            throw new Error("work-only evaluator should be skipped in verify mode");
          },
        },
      ],
      phaseGenerate: async () => {
        throw new Error("phaseGenerate should not run");
      },
    });

    expect(events).toEqual([]);
  });

  test("restores the work result after a clean verify pass", async () => {
    const ctx = createRunContext({
      mode: "verify",
      result: { text: "Updated x.", toolCalls: [], signal: "done" },
    });

    await phaseEvaluate(ctx, undefined, {
      shouldYieldNow: () => false,
      effects: [],
      evaluators: [
        {
          id: "review",
          modes: ["verify"],
          evaluate: () =>
            ctx.result?.signal === "done" ? { type: "regenerate", reason: "verify", mode: "verify" } : { type: "done" },
        },
      ],
      phaseGenerate: async () => {
        ctx.result = { text: "", toolCalls: [], signal: "no_op" };
        ctx.currentError = undefined;
      },
    });

    expect(ctx.result).toEqual({ text: "Updated x.", toolCalls: [], signal: "done" });
    expect(ctx.lifecycleState.reviewCandidate).toEqual({
      result: { text: "Updated x.", toolCalls: [], signal: "done" },
      currentError: undefined,
    });
    expect(ctx.lifecycleState.reviewResult).toEqual({ status: "clean" });
  });

  test("preserves a blocked verify result instead of restoring the work result", async () => {
    const ctx = createRunContext({
      mode: "verify",
      result: { text: "Updated x.", toolCalls: [], signal: "done" },
    });

    await phaseEvaluate(ctx, undefined, {
      shouldYieldNow: () => false,
      effects: [],
      evaluators: [
        {
          id: "review",
          modes: ["verify"],
          evaluate: () =>
            ctx.result?.signal === "done" ? { type: "regenerate", reason: "verify", mode: "verify" } : { type: "done" },
        },
      ],
      phaseGenerate: async () => {
        ctx.result = {
          text: "Need generated artifacts before I can review this change.",
          toolCalls: [],
          signal: "blocked",
        };
        ctx.currentError = undefined;
      },
    });

    expect(ctx.result).toEqual({
      text: "Need generated artifacts before I can review this change.",
      toolCalls: [],
      signal: "blocked",
    });
    expect(ctx.lifecycleState.reviewCandidate).toEqual({
      result: { text: "Updated x.", toolCalls: [], signal: "done" },
      currentError: undefined,
    });
    expect(ctx.lifecycleState.reviewResult).toEqual({
      status: "blocked",
      details: "Need generated artifacts before I can review this change.",
    });
  });

  test("stops regeneration when a reason-specific budget is exhausted", async () => {
    const ctx = createRunContext({
      result: { text: "done", toolCalls: [] },
      regenerationCounts: {
        "guard-recovery": 0,
        lint: 0,
        verify: 1,
        "tool-recovery": 0,
        "repeated-failure": 0,
      },
      policy: {
        ...createRunContext().policy,
        maxRegenerationsPerReason: {
          "guard-recovery": 2,
          lint: 1,
          verify: 1,
          "tool-recovery": 2,
          "repeated-failure": 1,
        },
      },
      debug: (event, fields) => {
        if (event !== "lifecycle.eval.skipped") return;
        expect(fields?.reason).toBe("regeneration_reason_cap");
        expect(fields?.regeneration_reason).toBe("verify");
      },
    });

    await phaseEvaluate(ctx, undefined, {
      shouldYieldNow: () => false,
      effects: [],
      evaluators: [
        {
          id: "verify-cycle",
          modes: ["work"],
          evaluate: () => ({
            type: "regenerate",
            reason: "verify",
            feedback: { source: "verify", mode: "verify", summary: "Review the changes." },
            mode: "verify",
          }),
        },
      ],
      phaseGenerate: async () => {
        throw new Error("phaseGenerate should not run after the verify budget is exhausted");
      },
    });

    expect(ctx.regenerationLimitHit).toBe(true);
    expect(ctx.regenerationCount).toBe(0);
  });
});
