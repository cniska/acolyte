import { describe, expect, mock, test } from "bun:test";
import type { ChatResponse } from "./api";
import { runLifecycle, scheduleMemoryCommit } from "./lifecycle";
import { createRunControl } from "./lifecycle-contract";
import { createLifecycleDeps, createLifecycleInput } from "./test-utils";
import { RUNNER_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";

describe("runLifecycle", () => {
  test("orchestrates phases", async () => {
    const deps = createLifecycleDeps();

    const response = await runLifecycle(
      createLifecycleInput({ soulPrompt: "SOUL", workspace: process.cwd(), taskId: "task_test" }),
      deps,
    );

    expect(deps.phasePrepare).toHaveBeenCalledTimes(1);
    expect(deps.createRunAgent).toHaveBeenCalledTimes(1);
    expect(deps.phaseGenerate).toHaveBeenCalledTimes(1);
    expect(deps.phaseFinalize).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ state: "done", model: "gpt-5-mini", output: "Generated output" });
  });

  test("threads reasoning and temperature from input into the run context", async () => {
    let captured: { reasoning?: string; temperature?: number } | undefined;
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx: { reasoning?: string; temperature?: number; result?: unknown }) => {
        captured = { reasoning: ctx.reasoning, temperature: ctx.temperature };
        ctx.result = { text: "ok", toolCalls: [], signal: "done" };
      }),
    });

    await runLifecycle(createLifecycleInput({ reasoning: "high", temperature: 0.3, workspace: process.cwd() }), deps);

    expect(captured?.reasoning).toBe("high");
    expect(captured?.temperature).toBe(0.3);
  });

  test("accounts memory tokens when distilling", async () => {
    const deps = createLifecycleDeps({
      phaseFinalize: mock(
        (ctx: { promptUsage: { memoryTokens: number } }): ChatResponse => ({
          state: "done",
          model: "gpt-5-mini",
          output: String(ctx.promptUsage.memoryTokens),
        }),
      ),
    });

    const response = await runLifecycle(
      createLifecycleInput({
        request: { model: "gpt-5-mini", message: "test", history: [] },
        soulPrompt: "SOUL",
        workspace: process.cwd(),
      }),
      deps,
    );

    expect(Number(response.output)).toBeGreaterThan(0);
  });

  test("adds distill tokens on top of existing memory tokens", async () => {
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx: { promptUsage: { memoryTokens: number }; result?: unknown }) => {
        ctx.promptUsage.memoryTokens = 5;
        ctx.result = { text: "Generated output", toolCalls: [], signal: "done" };
      }),
      phaseFinalize: mock(
        (ctx: { promptUsage: { memoryTokens: number } }): ChatResponse => ({
          state: "done",
          model: "gpt-5-mini",
          output: String(ctx.promptUsage.memoryTokens),
        }),
      ),
    });

    const response = await runLifecycle(
      createLifecycleInput({
        request: { model: "gpt-5-mini", message: "test", history: [] },
        soulPrompt: "SOUL",
        workspace: process.cwd(),
      }),
      deps,
    );

    expect(Number(response.output)).toBeGreaterThan(5);
  });

  test("rejects done after source writes without later validation", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx) => {
        ctx.session.callLog.push({
          toolName: "file-edit",
          args: { path: "src/app.ts" },
          taskId: ctx.taskId,
          status: "succeeded",
        });
        ctx.result = { text: "Done.", toolCalls: [], signal: "done" };
      }),
      phaseFinalize: mock((ctx): ChatResponse => {
        const error = ctx.currentError?.message;
        return {
          state: ctx.currentError?.blocksCompletion ? "awaiting-input" : "done",
          model: ctx.model,
          output: error ?? ctx.result?.text ?? "",
          ...(error ? { error } : {}),
        };
      }),
    });

    const response = await runLifecycle(
      createLifecycleInput({
        soulPrompt: "SOUL",
        workspace: process.cwd(),
        taskId: "task_test",
        onDebug: (entry) => events.push(entry),
      }),
      deps,
    );

    expect(WRITE_TOOL_SET.has("file-edit")).toBe(true);
    expect(response.state).toBe("awaiting-input");
    expect(response.error).toContain("changed and no later validation targeted it");
    expect(events.find((entry) => entry.event === "lifecycle.signal.rejected")?.fields?.reason).toBe(
      "missing-validation-after-write",
    );
  });

  test("rejects done when the last runner failed (broken-handoff gate)", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx) => {
        ctx.session.callLog.push({
          toolName: "test-run",
          args: { command: "bun test src/app.test.ts" },
          taskId: ctx.taskId,
          status: "failed",
          exitCode: 1,
        });
        ctx.result = { text: "Done.", toolCalls: [], signal: "done" };
      }),
      phaseFinalize: mock((ctx): ChatResponse => {
        const error = ctx.currentError?.message;
        return {
          state: ctx.currentError?.blocksCompletion ? "awaiting-input" : "done",
          model: ctx.model,
          output: error ?? ctx.result?.text ?? "",
          ...(error ? { error } : {}),
        };
      }),
    });

    const response = await runLifecycle(
      createLifecycleInput({
        soulPrompt: "SOUL",
        workspace: process.cwd(),
        taskId: "task_test",
        onDebug: (entry) => events.push(entry),
      }),
      deps,
    );

    expect(RUNNER_TOOL_SET.has("test-run")).toBe(true);
    expect(response.state).toBe("awaiting-input");
    expect(response.error).toContain("exit code 1");
    expect(response.error).toContain("bun test src/app.test.ts");
    expect(events.find((e) => e.event === "lifecycle.signal.rejected")?.fields?.reason).toBe("broken-handoff");
  });

  test("rejects a done that wrote no final answer (empty-answer gate)", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx) => {
        ctx.result = { text: "", toolCalls: [], signal: "done" };
      }),
      phaseFinalize: mock((ctx): ChatResponse => {
        const error = ctx.currentError?.message;
        return {
          state: ctx.currentError?.blocksCompletion ? "awaiting-input" : "done",
          model: ctx.model,
          output: error ?? ctx.result?.text ?? "",
          ...(error ? { error } : {}),
        };
      }),
    });

    const response = await runLifecycle(
      createLifecycleInput({
        soulPrompt: "SOUL",
        workspace: process.cwd(),
        taskId: "task_test",
        onDebug: (entry) => events.push(entry),
      }),
      deps,
    );

    expect(response.state).toBe("awaiting-input");
    expect(response.error).toContain("without writing a final response");
    expect(events.find((e) => e.event === "lifecycle.signal.rejected")?.fields?.reason).toBe("empty-answer");
  });
});

describe("scheduleMemoryCommit", () => {
  test("invokes commit function asynchronously", async () => {
    const calls: Array<{ sessionId?: string }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [],
        output: "done",
      },
      () => {},
      undefined,
      async (ctx) => {
        calls.push({ sessionId: ctx.sessionId });
        return undefined;
      },
      async (_key: string, job: () => Promise<void>) => {
        await job();
      },
    );
    await Promise.resolve();
    expect(calls).toEqual([{ sessionId: "sess_test0001" }]);
  });

  test("logs debug event when commit fails", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      },
      (event, fields) => {
        events.push({ event, fields });
      },
      undefined,
      async () => {
        throw new Error("commit failed");
      },
      async (_key: string, job: () => Promise<void>) => {
        await job();
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const failed = events.find((entry) => entry.event === "lifecycle.memory.commit_failed");
    expect(failed).toBeDefined();
    expect(failed?.fields?.session_id).toBe("sess_test0001");
    expect(failed?.fields?.message_count).toBe(1);
    expect(failed?.fields?.output_chars).toBe(4);
    expect(failed?.fields?.queue_key).toBe("sess_test0001");
    expect(failed?.fields?.message).toBe("commit failed");
  });

  test("logs debug events when commit succeeds", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      },
      (event, fields) => {
        events.push({ event, fields });
      },
      undefined,
      async () => undefined,
      async (_key: string, job: () => Promise<void>) => {
        await job();
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    const scheduled = events.find((entry) => entry.event === "lifecycle.memory.commit_scheduled");
    const done = events.find((entry) => entry.event === "lifecycle.memory.commit_done");
    expect(scheduled).toBeDefined();
    expect(done).toBeDefined();
    expect(scheduled?.fields?.session_id).toBe("sess_test0001");
    expect(scheduled?.fields?.message_count).toBe(1);
    expect(scheduled?.fields?.output_chars).toBe(4);
    expect(done?.fields?.queue_key).toBe("sess_test0001");
    expect(done?.fields?.project_promoted_facts).toBe(0);
    expect(done?.fields?.user_promoted_facts).toBe(0);
    expect(done?.fields?.session_scoped_facts).toBe(0);
    expect(done?.fields?.dropped_untagged_facts).toBe(0);
    expect(done?.fields?.distill_tokens).toBe(0);
  });

  test("logs commit metrics when commit returns promotion stats", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      },
      (event, fields) => {
        events.push({ event, fields });
      },
      undefined,
      async () => ({
        projectPromotedFacts: 2,
        userPromotedFacts: 1,
        sessionScopedFacts: 3,
        droppedUntaggedFacts: 4,
      }),
      async (_key: string, job: () => Promise<void>) => {
        await job();
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    const done = events.find((entry) => entry.event === "lifecycle.memory.commit_done");
    expect(done).toBeDefined();
    expect(done?.fields?.project_promoted_facts).toBe(2);
    expect(done?.fields?.user_promoted_facts).toBe(1);
    expect(done?.fields?.session_scoped_facts).toBe(3);
    expect(done?.fields?.dropped_untagged_facts).toBe(4);
  });
});

describe("runLifecycle yield", () => {
  const baseInput = createLifecycleInput({ soulPrompt: "SOUL", workspace: process.cwd(), taskId: "task_test" });

  test("skips acceptResult when runControl yields", async () => {
    const deps = createLifecycleDeps();
    const debugEvents: string[] = [];
    const response = await runLifecycle(
      {
        ...baseInput,
        runControl: createRunControl({ shouldYield: () => true }),
        onDebug: (entry) => debugEvents.push(entry.event),
      },
      deps,
    );
    expect(response.output).toBe("Generated output");
    expect(debugEvents).toContain("lifecycle.yield");
  });

  test("replaces empty text when yielding", async () => {
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx: { result?: unknown }) => {
        ctx.result = { text: "  ", toolCalls: [{ toolCallId: "tc1", toolName: "read", args: {} }] };
      }),
      phaseFinalize: mock(
        (ctx: { result?: { text: string } }): ChatResponse => ({
          state: "done",
          model: "gpt-5-mini",
          output: ctx.result?.text ?? "",
        }),
      ),
    });
    const response = await runLifecycle(
      {
        ...baseInput,
        runControl: createRunControl({ shouldYield: () => true }),
      },
      deps,
    );
    expect(response.output).toBe("Yielding to a newer pending message.");
  });

  test("proceeds normally without runControl", async () => {
    const deps = createLifecycleDeps();
    const debugEvents: string[] = [];
    const onDebug = (entry: { event: string }) => debugEvents.push(entry.event);
    const response = await runLifecycle({ ...baseInput, onDebug }, deps);
    expect(response.output).toBe("Generated output");
    expect(debugEvents).not.toContain("lifecycle.yield");
  });
});
