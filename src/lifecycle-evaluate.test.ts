import { describe, expect, test } from "bun:test";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import type { GenerateResult, RunContext, StreamChunk } from "./lifecycle-contract";
import { phaseEvaluate } from "./lifecycle-evaluate";
import { createRunContext } from "./test-utils";
import { createSessionContext, recordCall } from "./tool-guards";
import { WRITE_TOOL_SET } from "./tool-registry";

function createStaticAgent(result: GenerateResult): RunContext["agent"] {
  return {
    id: "test-agent",
    name: "test-agent",
    instructions: "",
    model: {} as RunContext["agent"]["model"],
    tools: {},
    async stream() {
      return {
        fullStream: new ReadableStream<StreamChunk>({
          start(controller) {
            controller.close();
          },
        }),
        async getFullOutput() {
          return result;
        },
      };
    },
  };
}

describe("phaseEvaluate", () => {
  test("stops on repeated unknown errors and fills the fallback message for empty output", async () => {
    const ctx = createRunContext({
      currentError: {
        message: "Unknown failure",
        code: LIFECYCLE_ERROR_CODES.unknown,
        category: "other",
        source: "generate",
      },
      result: {
        text: "  ",
        toolCalls: [],
      },
    });
    ctx.errorStats.other = ctx.policy.maxUnknownErrorsPerRequest;

    await phaseEvaluate(ctx, () => false);

    expect(ctx.regenerationLimitHit).toBe(true);
    expect(ctx.regenerationCount).toBe(0);
    expect(ctx.result).toEqual({
      text: "Stopped after repeated unknown errors. Narrow the task scope or inspect lifecycle traces and retry.",
      toolCalls: [],
    });
  });

  test("stores verify output and restores the prior work result after verify regeneration", async () => {
    const session = createSessionContext("task_verify", WRITE_TOOL_SET);
    recordCall(session, "file-edit", { path: "src/a.ts" });
    recordCall(session, "test-run", { files: ["src/a.test.ts"] });

    const ctx = createRunContext({
      taskId: "task_verify",
      session,
      result: {
        text: "Updated src/a.ts",
        toolCalls: [],
        signal: "done",
      },
      observedTools: new Set(["file-edit"]),
      agentForMode: "verify",
      agent: createStaticAgent({
        text: "No issues found.",
        toolCalls: [],
        signal: "done",
      }),
    });

    await phaseEvaluate(ctx, () => false);

    expect(ctx.regenerationCount).toBe(1);
    expect(ctx.mode).toBe("verify");
    expect(ctx.result).toEqual({
      text: "Updated src/a.ts",
      toolCalls: [],
      signal: "done",
    });
    expect(ctx.lifecycleState.verifyOutcome).toEqual({
      text: "No issues found.",
      error: undefined,
    });
  });

  test("skips evaluator-triggered regeneration when the regeneration cap is already reached", async () => {
    const session = createSessionContext("task_verify", WRITE_TOOL_SET);
    recordCall(session, "file-edit", { path: "src/a.ts" });

    const ctx = createRunContext({
      taskId: "task_verify",
      session,
      result: {
        text: "Updated src/a.ts",
        toolCalls: [],
        signal: "done",
      },
      observedTools: new Set(["file-edit"]),
      regenerationCount: 1,
      policy: {
        ...createRunContext().policy,
        maxRegenerationsPerRequest: 1,
      },
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream() {
          throw new Error("phaseGenerate should not run when regeneration is capped");
        },
      },
    });

    await phaseEvaluate(ctx, () => false);

    expect(ctx.regenerationLimitHit).toBe(true);
    expect(ctx.regenerationCount).toBe(1);
    expect(ctx.mode).toBe("work");
    expect(ctx.lifecycleState.verifyOutcome).toBeUndefined();
    expect(ctx.result).toEqual({
      text: "Updated src/a.ts",
      toolCalls: [],
      signal: "done",
    });
  });
});
