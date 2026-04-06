import { describe, expect, mock, test } from "bun:test";
import type { ChatResponse } from "./api";
import { runLifecycle, scheduleMemoryCommit, shouldCommitMemory } from "./lifecycle";
import { createRunControl } from "./lifecycle-contract";
import { createLifecycleDeps } from "./test-utils";

describe("runLifecycle", () => {
  test("orchestrates phases", async () => {
    const deps = createLifecycleDeps();

    const response = await runLifecycle(
      {
        request: { model: "gpt-5-mini", message: "test", history: [], useMemory: false },
        soulPrompt: "SOUL",
        workspace: process.cwd(),
        taskId: "task_test",
      },
      deps,
    );

    expect(deps.phasePrepare).toHaveBeenCalledTimes(1);
    expect(deps.createRunAgent).toHaveBeenCalledTimes(1);
    expect(deps.phaseGenerate).toHaveBeenCalledTimes(1);
    expect(deps.phaseFinalize).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ state: "done", model: "gpt-5-mini", output: "Generated output" });
  });
});

describe("shouldCommitMemory", () => {
  test("returns false when request disables memory", () => {
    expect(
      shouldCommitMemory({
        request: { model: "gpt-5-mini", message: "test", history: [], useMemory: false },
        soulPrompt: "",
      }),
    ).toBe(false);
  });

  test("returns true when request does not disable memory", () => {
    expect(
      shouldCommitMemory({
        request: { model: "gpt-5-mini", message: "test", history: [] },
        soulPrompt: "",
      }),
    ).toBe(true);
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

describe("createRunControl", () => {
  test("defaults to no-op callbacks", () => {
    const rc = createRunControl();
    expect(rc.shouldYield()).toBe(false);
    expect(rc.isCancelled()).toBe(false);
  });

  test("accepts partial overrides", () => {
    const rc = createRunControl({ shouldYield: () => true });
    expect(rc.shouldYield()).toBe(true);
    expect(rc.isCancelled()).toBe(false);
  });

  test("accepts full overrides", () => {
    const rc = createRunControl({ shouldYield: () => true, isCancelled: () => true });
    expect(rc.shouldYield()).toBe(true);
    expect(rc.isCancelled()).toBe(true);
  });
});

describe("runLifecycle yield", () => {
  const baseInput = {
    request: { model: "gpt-5-mini" as const, message: "test", history: [] as never[], useMemory: false },
    soulPrompt: "SOUL",
    workspace: process.cwd(),
    taskId: "task_test",
  };

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
