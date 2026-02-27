import { describe, expect, test } from "bun:test";
import { autoVerifier, efficiencyEvaluator, planDetector, type RunContext } from "./agent-lifecycle";
import { createSessionContext } from "./tool-guards";

function createMockContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    request: { model: "gpt-5-mini", message: "test", history: [] },
    workspace: undefined,
    soulPrompt: "",
    emit: () => {},
    debug: () => {},
    classifiedMode: "work",
    mode: "work",
    model: "gpt-5-mini",
    session: createSessionContext(),
    agent: {} as RunContext["agent"],
    agentInput: "test prompt",
    promptUsage: {
      promptTokens: 0,
      promptBudgetTokens: 8000,
      promptTruncated: false,
      includedHistoryMessages: 0,
      totalHistoryMessages: 0,
    },
    observedTools: new Set(),
    modelCallCount: 1,
    regenerationCount: 0,
    regenerationLimitHit: false,
    nativeIdQueue: new Map(),
    toolCallStartedAt: new Map(),
    toolOutputHandler: null,
    ...overrides,
  };
}

describe("planDetector", () => {
  test("returns regenerate when output is plan-like with no tools", () => {
    const ctx = createMockContext({
      result: { text: "Plan:\n1. Edit the file\n2. Run verify", toolCalls: [] },
      observedTools: new Set(),
    });
    const action = planDetector.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.prompt).toContain("Execute the task directly");
    }
  });

  test("returns done when tools were used", () => {
    const ctx = createMockContext({
      result: { text: "Plan:\n1. Edit the file", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(planDetector.evaluate(ctx).type).toBe("done");
  });

  test("returns done when output is not plan-like", () => {
    const ctx = createMockContext({
      result: { text: "Updated src/agent.ts.", toolCalls: [] },
      observedTools: new Set(),
    });
    expect(planDetector.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no result", () => {
    const ctx = createMockContext({ result: undefined });
    expect(planDetector.evaluate(ctx).type).toBe("done");
  });
});

describe("autoVerifier", () => {
  test("returns regenerate when write tools used without verify", () => {
    const ctx = createMockContext({
      classifiedMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "edit-file"]),
    });
    const action = autoVerifier.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("verify");
      expect(action.keepResult).toBe(true);
    }
  });

  test("returns done when verifyRan flag is set", () => {
    const session = createSessionContext();
    session.flags.verifyRan = true;
    const ctx = createMockContext({
      classifiedMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });

  test("returns done in plan mode", () => {
    const ctx = createMockContext({
      classifiedMode: "plan",
      result: { text: "Found it.", toolCalls: [] },
      observedTools: new Set(["read-file"]),
    });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no write tools used", () => {
    const ctx = createMockContext({
      classifiedMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "search-files"]),
    });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no result", () => {
    const ctx = createMockContext({ result: undefined });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });
});

describe("efficiencyEvaluator", () => {
  test("returns regenerate when work mode over-explores without any write", () => {
    const session = createSessionContext();
    session.callLog = [
      { toolName: "find-files", args: {} },
      { toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] } },
      { toolName: "search-files", args: {} },
    ];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Implement the fix directly", history: [] },
      classifiedMode: "work",
      session,
      result: { text: "I found the files.", toolCalls: [] },
    });
    const action = efficiencyEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
  });

  test("returns regenerate on repeated read-file calls even with lower discovery volume", () => {
    const session = createSessionContext();
    session.callLog = [
      { toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] } },
      { toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] } },
      { toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] } },
    ];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Implement the fix directly", history: [] },
      classifiedMode: "work",
      session,
      result: { text: "I found the files.", toolCalls: [] },
    });
    expect(efficiencyEvaluator.evaluate(ctx).type).toBe("regenerate");
  });

  test("returns done when a write tool was used", () => {
    const session = createSessionContext();
    session.callLog = [
      { toolName: "read-file", args: {} },
      { toolName: "edit-file", args: { path: "src/a.ts" } },
    ];
    const ctx = createMockContext({
      classifiedMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
    });
    expect(efficiencyEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done outside work mode", () => {
    const session = createSessionContext();
    session.callLog = [
      { toolName: "find-files", args: {} },
      { toolName: "read-file", args: {} },
      { toolName: "search-files", args: {} },
    ];
    const ctx = createMockContext({
      classifiedMode: "plan",
      session,
      result: { text: "Found it.", toolCalls: [] },
    });
    expect(efficiencyEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done for work-classified prompts without strong write intent", () => {
    const session = createSessionContext();
    session.callLog = [
      { toolName: "find-files", args: {} },
      { toolName: "read-file", args: {} },
      { toolName: "search-files", args: {} },
      { toolName: "read-file", args: {} },
    ];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Improve robustness and report findings only", history: [] },
      classifiedMode: "work",
      session,
      result: { text: "Findings...", toolCalls: [] },
    });
    expect(efficiencyEvaluator.evaluate(ctx).type).toBe("done");
  });
});

describe("evaluator ordering", () => {
  test("plan detection and efficiency run before auto-verify", () => {
    const evaluators = [planDetector, efficiencyEvaluator, autoVerifier];
    expect(evaluators[0].id).toBe("plan-detector");
    expect(evaluators[1].id).toBe("efficiency-evaluator");
    expect(evaluators[2].id).toBe("auto-verifier");
  });
});
