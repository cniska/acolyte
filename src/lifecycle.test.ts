import { describe, expect, mock, test } from "bun:test";
import type { ChatResponse } from "./api";
import { runLifecycle, scheduleMemoryCommit } from "./lifecycle";
import { createRunControl } from "./lifecycle-contract";
import { createLifecycleDeps, createLifecycleInput } from "./test-utils";

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

  test("does not distill a turn whose completion was withheld", async () => {
    // A terminally blocked completion (blocksCompletion) carries claims the harness judged
    // unsubstantiated — committing them to memory records anti-facts. The true facts
    // re-distill on the completing follow-up turn.
    const events: Array<{ event: string }> = [];
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx: { result?: unknown; currentError?: unknown }) => {
        ctx.result = { text: "Done.", toolCalls: [], signal: "done" };
        ctx.currentError = {
          message: "The agent finished without validating its changes to `src/app.ts`.",
          code: "unknown",
          category: "other",
          blocksCompletion: true,
        };
      }),
    });

    await runLifecycle(
      createLifecycleInput({
        soulPrompt: "SOUL",
        workspace: process.cwd(),
        onDebug: (entry) => events.push(entry),
      }),
      deps,
    );

    expect(events.some((e) => e.event === "lifecycle.memory.commit_scheduled")).toBe(false);
  });

  test("distills a finished turn that carries a non-blocking error", async () => {
    // A `blocked` signal is a finished turn (agent genuinely needs input) whose reason is
    // worth remembering — it sets no `blocksCompletion` error, so it still commits.
    const events: Array<{ event: string }> = [];
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx: { result?: unknown }) => {
        ctx.result = {
          text: "Blocked: I need the API key.",
          toolCalls: [],
          signal: "blocked",
          signalReason: "need key",
        };
      }),
    });

    await runLifecycle(
      createLifecycleInput({
        soulPrompt: "SOUL",
        workspace: process.cwd(),
        onDebug: (entry) => events.push(entry),
      }),
      deps,
    );

    expect(events.some((e) => e.event === "lifecycle.memory.commit_scheduled")).toBe(true);
  });

  test("distills a turn whose error does not block completion", async () => {
    // Discriminates the predicate: only `blocksCompletion` gates the commit, not any error.
    // A non-blocking error left on a turn that still produced real text must not skip the
    // commit — a guard of `if (ctx.currentError)` would wrongly suppress this.
    const events: Array<{ event: string }> = [];
    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx: { result?: unknown; currentError?: unknown }) => {
        ctx.result = { text: "Hit a transient tool error, but here is the answer.", toolCalls: [], signal: "done" };
        ctx.currentError = { message: "transient tool error", code: "unknown", category: "other" };
      }),
    });

    await runLifecycle(
      createLifecycleInput({
        soulPrompt: "SOUL",
        workspace: process.cwd(),
        onDebug: (entry) => events.push(entry),
      }),
      deps,
    );

    expect(events.some((e) => e.event === "lifecycle.memory.commit_scheduled")).toBe(true);
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
