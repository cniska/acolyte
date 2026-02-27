import { describe, expect, test } from "bun:test";
import { autoVerifier, planDetector, type RunContext } from "./agent-lifecycle";
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
    nativeIdQueue: new Map(),
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

describe("evaluator ordering", () => {
  test("plan detection runs before auto-verify", () => {
    const evaluators = [planDetector, autoVerifier];
    expect(evaluators[0].id).toBe("plan-detector");
    expect(evaluators[1].id).toBe("auto-verifier");
  });
});
