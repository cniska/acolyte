import { describe, expect, test } from "bun:test";
import { parseChatResponse } from "./client-contract";
import { phaseFinalize } from "./lifecycle-finalize";
import { createRunContext } from "./test-utils";
import { createSessionContext } from "./tool-session";

describe("ChatResponse error field", () => {
  test("parseChatResponse preserves error field", () => {
    const response = parseChatResponse({
      output: "No output from model.",
      model: "gpt-5-mini",
      error: "Your credit balance is too low",
    });
    expect(response).not.toBeNull();
    expect(response?.error).toBe("Your credit balance is too low");
  });

  test("parseChatResponse omits error when not present", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
    });
    expect(response).not.toBeNull();
    expect(response?.error).toBeUndefined();
  });

  test("parseChatResponse rejects non-string error", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      error: 42,
    });
    expect(response).toBeNull();
  });
});

describe("phaseFinalize", () => {
  test("derives prompt breakdown from promptUsage for token accounting", () => {
    const ctx = createRunContext({
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        skillTokens: 0,
        memoryTokens: 0,
        messageTokens: 12,
        inputBudgetTokens: 100,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      inputTokensAccum: 0,
      outputTokensAccum: 0,
      result: { text: "done", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.usage?.inputTokens).toBe(80);
    expect(response.usage?.totalTokens).toBe(81);
    expect(response.promptBreakdown?.usedTokens).toBe(80);
    expect(response.promptBreakdown).toEqual({
      budgetTokens: 100,
      usedTokens: 80,
      systemTokens: 48,
      toolTokens: 20,
      skillTokens: 0,
      memoryTokens: 0,
      messageTokens: 12,
    });
  });

  test("includes promptBreakdown when currentError is set", () => {
    const ctx = createRunContext({
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        skillTokens: 0,
        memoryTokens: 0,
        messageTokens: 12,
        inputBudgetTokens: 100,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      inputTokensAccum: 0,
      outputTokensAccum: 0,
      currentError: { message: "tool failed", category: "other" },
      result: { text: "", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.error).toBe("tool failed");
    expect(response.promptBreakdown).toBeDefined();
    expect(response.promptBreakdown?.usedTokens).toBe(80);
  });

  test("sets state to awaiting-input when signal is blocked", () => {
    const ctx = createRunContext({
      result: {
        text: "Which environment should I deploy to?",
        toolCalls: [],
        signal: "blocked",
        signalReason: "Missing deployment environment. I will deploy once it is provided.",
      },
      acceptedSignal: "blocked",
    });
    const response = phaseFinalize(ctx);
    expect(response.state).toBe("awaiting-input");
    expect(response.output).toBe("Which environment should I deploy to?");
  });

  test("uses blocked signal reason when final text is empty", () => {
    const ctx = createRunContext({
      result: {
        text: "",
        toolCalls: [],
        signal: "blocked",
        signalReason: "Missing deployment environment. I will deploy once it is provided.",
      },
      acceptedSignal: "blocked",
    });
    const response = phaseFinalize(ctx);
    expect(response.state).toBe("awaiting-input");
    expect(response.output).toBe("Missing deployment environment. I will deploy once it is provided.");
  });

  test("sets state to done when signal is done", () => {
    const ctx = createRunContext({
      result: { text: "Done.", toolCalls: [], signal: "done" },
      acceptedSignal: "done",
    });
    const response = phaseFinalize(ctx);
    expect(response.state).toBe("done");
  });

  test("counts recall probes separately and keeps them out of search/discovery", () => {
    const session = createSessionContext("task_1");
    session.callLog.push(
      { toolName: "memory-search", args: {}, taskId: "task_1", status: "succeeded" },
      { toolName: "session-search", args: {}, taskId: "task_1", status: "succeeded" },
      { toolName: "session-search", args: {}, taskId: "task_1", status: "succeeded" },
      { toolName: "file-search", args: {}, taskId: "task_1", status: "succeeded" },
      { toolName: "file-read", args: {}, taskId: "task_1", status: "succeeded" },
      // A call from a different task must not be counted.
      { toolName: "session-search", args: {}, taskId: "task_other", status: "succeeded" },
    );
    let summary: Record<string, unknown> | undefined;
    const ctx = createRunContext({
      taskId: "task_1",
      session,
      result: { text: "done", toolCalls: [] },
      debug: (event, fields) => {
        if (event === "lifecycle.summary") summary = fields;
      },
    });

    phaseFinalize(ctx);

    expect(summary?.memory_search_calls).toBe(1);
    expect(summary?.session_search_calls).toBe(2);
    // Only file-search counts as code search; session-search is excluded despite its
    // "search" category, and neither recall probe inflates pre-write discovery.
    expect(summary?.search_calls).toBe(1);
    expect(summary?.pre_write_discovery_calls).toBe(2);
  });

  test("uses signal-aware fallback output when final text is empty", () => {
    const done = phaseFinalize(
      createRunContext({ result: { text: "", toolCalls: [], signal: "done" }, acceptedSignal: "done" }),
    );
    const noop = phaseFinalize(
      createRunContext({ result: { text: "", toolCalls: [], signal: "noop" }, acceptedSignal: "noop" }),
    );
    expect(done.output).toBe("Done.");
    expect(noop.output).toBe("No changes needed.");
  });

  test("blocks done output when a tool error is unresolved", () => {
    const ctx = createRunContext({
      currentError: {
        message: "file-edit failed: Find text matched 2 locations",
        category: "other",
        source: "tool-error",
        tool: "file-edit",
      },
      result: { text: "I updated the tests.", toolCalls: [], signal: "done" },
    });

    const response = phaseFinalize(ctx);

    expect(response.state).toBe("awaiting-input");
    expect(response.output).toBe("I updated the tests.");
    expect(response.error).toBe("file-edit failed: Find text matched 2 locations");
  });

  test("blocks done output when completion evidence is missing", () => {
    const ctx = createRunContext({
      currentError: {
        message: "Cannot finish yet: `src/app.ts` changed after the last successful validation.",
        category: "other",
        blocksCompletion: true,
      },
      result: { text: "I updated the file.", toolCalls: [], signal: "done" },
    });

    const response = phaseFinalize(ctx);

    expect(response.state).toBe("awaiting-input");
    expect(response.output).toBe("I updated the file.");
    expect(response.error).toBe("Cannot finish yet: `src/app.ts` changed after the last successful validation.");
  });

  test("blocking error with no model text emits empty output, not a fallback bubble", () => {
    const ctx = createRunContext({
      currentError: { message: "Cannot finish yet: validation missing", category: "other", blocksCompletion: true },
      result: { text: "", toolCalls: [], signal: "done" },
    });

    const response = phaseFinalize(ctx);

    expect(response.state).toBe("awaiting-input");
    // The error row is authoritative; no placeholder output to render beside it.
    expect(response.output).toBe("");
    expect(response.error).toBe("Cannot finish yet: validation missing");
  });

  test("does not use an unaccepted blocked signal for response state", () => {
    const ctx = createRunContext({
      currentError: { message: "tool failed", category: "other" },
      result: { text: "Cannot proceed.", toolCalls: [], signal: "blocked" },
    });
    const response = phaseFinalize(ctx);
    expect(response.state).toBe("done");
    expect(response.error).toBe("tool failed");
  });

  test("includes activeSkills when session has them", () => {
    const skills = [{ name: "build", instructions: "Build instructions" }];
    const ctx = createRunContext({
      result: { text: "Done.", toolCalls: [] },
    });
    ctx.session.activeSkills = skills;
    const response = phaseFinalize(ctx);
    expect(response.activeSkills).toEqual(skills);
  });

  test("omits activeSkills when session has none", () => {
    const ctx = createRunContext({
      result: { text: "Done.", toolCalls: [] },
    });
    const response = phaseFinalize(ctx);
    expect(response.activeSkills).toBeUndefined();
  });
});

describe("parseChatResponse activeSkills", () => {
  test("preserves activeSkills from response", () => {
    const skills = [{ name: "build", instructions: "Build instructions" }];
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      activeSkills: skills,
    });
    expect(response?.activeSkills).toEqual(skills);
  });

  test("omits activeSkills when not present", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
    });
    expect(response?.activeSkills).toBeUndefined();
  });
});
