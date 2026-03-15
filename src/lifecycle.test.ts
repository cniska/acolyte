import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ChatResponse } from "./api";
import { scheduleMemoryCommit, shouldCommitMemory } from "./lifecycle";
import { createSessionContext } from "./tool-guards";

const phasePrepare = mock(() => ({
  session: createSessionContext(),
  tools: {},
  baseAgentInput: "BASE_INPUT",
  promptUsage: {
    inputTokens: 0,
    inputBudgetTokens: 8000,
    systemPromptTokens: 0,
    toolTokens: 0,
    memoryTokens: 0,
    messageTokens: 0,
    inputTruncated: false,
    includedHistoryMessages: 0,
    totalHistoryMessages: 0,
  },
}));

const phaseGenerate = mock(async (ctx: { result?: unknown }) => {
  ctx.result = { text: "Generated output", toolCalls: [], signal: "done" };
});

const phaseEvaluate = mock(
  async (ctx: { session: { flags: { totalStepLimit?: number } }; result?: { text: string } }) => {
    expect(ctx.session.flags.totalStepLimit).toBe(12);
    expect(ctx.result?.text).toBe("Generated output");
  },
);

const phaseFinalize = mock(
  (ctx: { result?: { text: string } }): ChatResponse => ({
    model: "gpt-5-mini",
    output: ctx.result?.text ?? "",
  }),
);

const createModeAgent = mock(() => ({
  id: "test-agent",
  name: "test-agent",
  instructions: "",
  model: {} as never,
  tools: {},
  async stream() {
    throw new Error("createModeAgent stream should not be called in runLifecycle unit test");
  },
}));

beforeAll(() => {
  mock.module("./lifecycle-prepare", () => ({
    phasePrepare,
  }));

  mock.module("./lifecycle-generate", () => ({
    createModeAgent,
    phaseGenerate,
    shouldYieldNow: () => false,
  }));

  mock.module("./lifecycle-evaluate", () => ({
    phaseEvaluate,
  }));

  mock.module("./lifecycle-finalize", () => ({
    phaseFinalize,
  }));

  mock.module("./lifecycle-resolve", () => ({
    resolveInitialMode: () => ({ mode: "work", model: "gpt-5-mini" }),
  }));

  mock.module("./lifecycle-policy", () => ({
    resolveLifecyclePolicy: () => ({
      initialMaxSteps: 3,
      stepTimeoutMs: 1000,
      totalMaxSteps: 12,
      toolTimeoutMs: 5000,
      consecutiveGuardBlockLimit: 5,
      maxNudgesPerGeneration: 1,
    }),
  }));
});

describe("runLifecycle", () => {
  test("orchestrates prepare, generate, evaluate, and finalize", async () => {
    const { runLifecycle } = await import("./lifecycle");

    const response = await runLifecycle({
      request: { model: "gpt-5-mini", message: "test", history: [], useMemory: false },
      soulPrompt: "SOUL",
      workspace: "/tmp/workspace",
      taskId: "task_test",
    });

    expect(phasePrepare).toHaveBeenCalledTimes(1);
    expect(createModeAgent).toHaveBeenCalledTimes(1);
    expect(phaseGenerate).toHaveBeenCalledTimes(1);
    expect(phaseEvaluate).toHaveBeenCalledTimes(1);
    expect(phaseFinalize).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ model: "gpt-5-mini", output: "Generated output" });
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
      async (ctx) => {
        calls.push({ sessionId: ctx.sessionId });
        return undefined;
      },
      async (_key, job) => {
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
      async () => {
        throw new Error("commit failed");
      },
      async (_key, job) => {
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
      async () => undefined,
      async (_key, job) => {
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
      async () => ({
        projectPromotedFacts: 2,
        userPromotedFacts: 1,
        sessionScopedFacts: 3,
        droppedUntaggedFacts: 4,
      }),
      async (_key, job) => {
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
