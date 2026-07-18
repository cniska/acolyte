import { describe, expect, test } from "bun:test";
import { parseChatResponse } from "./client-contract";
import { phaseFinalize } from "./lifecycle-finalize";
import { createRunContext } from "./test-utils";
import { createSessionContext } from "./tool-session";
import { missingCatalogDisplayFields } from "./trace-event-catalog";

describe("ChatResponse error field", () => {
  test("parseChatResponse preserves error field", () => {
    const response = parseChatResponse({
      output: "No output from model.",
      model: "gpt-5-mini",
      outputStreamed: false,
      error: "Your credit balance is too low",
    });
    expect(response).not.toBeNull();
    expect(response?.error).toBe("Your credit balance is too low");
  });

  test("parseChatResponse omits error when not present", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      outputStreamed: false,
    });
    expect(response).not.toBeNull();
    expect(response?.error).toBeUndefined();
  });

  test("parseChatResponse rejects non-string error", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      outputStreamed: false,
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

  test("surfaces the model's final text as output with no error", () => {
    const ctx = createRunContext({
      result: { text: "Which environment should I deploy to?", toolCalls: [] },
    });
    const response = phaseFinalize(ctx);
    expect(response.output).toBe("Which environment should I deploy to?");
    expect(response.error).toBeUndefined();
  });

  test("marks a streamed answer outputStreamed so the client does not re-render it", () => {
    const ctx = createRunContext({
      result: { text: "All done.", textStreamed: true, toolCalls: [] },
    });
    expect(phaseFinalize(ctx).outputStreamed).toBe(true);
  });

  test("marks host-synthesized output (never streamed) outputStreamed=false so the client renders it", () => {
    // Mirrors the yield/stopped paths (lifecycle.ts): result.text is a host notice injected
    // after the stream ended, so textStreamed stays false and the client must show it.
    const ctx = createRunContext({
      result: { text: "Yielding to a newer pending message.", toolCalls: [] },
    });
    const response = phaseFinalize(ctx);
    expect(response.output).toBe("Yielding to a newer pending message.");
    expect(response.outputStreamed).toBe(false);
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

  test("counts duplicate discovery calls (repeated tool+args), independent of arg order", () => {
    const session = createSessionContext("task_dup");
    session.callLog.push(
      { toolName: "file-read", args: { path: "a.ts" }, taskId: "task_dup", status: "succeeded" },
      // Same read again — a duplicate.
      { toolName: "file-read", args: { path: "a.ts" }, taskId: "task_dup", status: "succeeded" },
      // Distinct read — not a duplicate.
      { toolName: "file-read", args: { path: "b.ts" }, taskId: "task_dup", status: "succeeded" },
      { toolName: "file-search", args: { pattern: "x", path: "src" }, taskId: "task_dup", status: "succeeded" },
      // Same search, keys in a different order — still a duplicate.
      { toolName: "file-search", args: { path: "src", pattern: "x" }, taskId: "task_dup", status: "succeeded" },
      // Recall probes are excluded from discovery, so their repeat does not count.
      { toolName: "session-search", args: { query: "y" }, taskId: "task_dup", status: "succeeded" },
      { toolName: "session-search", args: { query: "y" }, taskId: "task_dup", status: "succeeded" },
    );
    let summary: Record<string, unknown> | undefined;
    const ctx = createRunContext({
      taskId: "task_dup",
      session,
      result: { text: "done", toolCalls: [] },
      debug: (event, fields) => {
        if (event === "lifecycle.summary") summary = fields;
      },
    });

    phaseFinalize(ctx);

    expect(summary?.duplicate_discovery_calls).toBe(2);
  });

  test("lifecycle.summary debug event has all catalog display fields", () => {
    const debugEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const ctx = createRunContext({
      result: { text: "done", toolCalls: [] },
      errorStats: { timeout: 0, "file-not-found": 0, "budget-exhausted": 2, other: 0 },
      debug: (event, fields) => debugEvents.push({ event, fields: fields as Record<string, unknown> }),
    });

    phaseFinalize(ctx);

    const summary = debugEvents.find((e) => e.event === "lifecycle.summary");
    if (!summary) throw new Error("lifecycle.summary debug event not emitted");
    const missing = missingCatalogDisplayFields(
      "lifecycle.summary",
      summary.fields as Record<string, string | number | boolean | null | undefined>,
    );
    expect(missing).toEqual([]);
    expect(summary.fields.budget_exhausted_count).toBe(2);
  });

  test("an empty final response is blocked and surfaces no fabricated text", () => {
    // Real path: the empty-answer gate rejects a blank final response and sets a blocking
    // error, so finalize emits no output — the error row carries it.
    const blocked = phaseFinalize(
      createRunContext({
        result: { text: "", toolCalls: [] },
        currentError: {
          message: "The agent finished without writing a response. Retry or rephrase the request.",
          blocksCompletion: true,
        },
      }),
    );
    expect(blocked.output).toBe("");

    // A turn that carries the model's own words keeps them as the output.
    const withText = phaseFinalize(
      createRunContext({
        result: { text: "Already consistent; nothing to change.", toolCalls: [] },
      }),
    );
    expect(withText.output).toBe("Already consistent; nothing to change.");
  });

  test("a tool error alone does not block a completed turn at finalize", () => {
    // Tool errors no longer populate ctx.currentError; only a run-level (blocksCompletion)
    // error blocks. A turn that carries model text completes cleanly.
    const ctx = createRunContext({
      result: { text: "I updated the tests.", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.output).toBe("I updated the tests.");
    expect(response.error).toBeUndefined();
  });

  test("keeps the model's final text as output beside a blocking error", () => {
    const ctx = createRunContext({
      currentError: {
        message: "The agent finished without writing a response. Retry or rephrase the request.",
        category: "other",
        blocksCompletion: true,
      },
      result: { text: "I updated the file.", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.output).toBe("I updated the file.");
    expect(response.error).toBe("The agent finished without writing a response. Retry or rephrase the request.");
  });

  test("blocking error with no model text emits empty output, not a fallback bubble", () => {
    const ctx = createRunContext({
      currentError: { message: "Cannot finish yet: validation missing", category: "other", blocksCompletion: true },
      result: { text: "", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    // The error row is authoritative; no placeholder output to render beside it.
    expect(response.output).toBe("");
    expect(response.error).toBe("Cannot finish yet: validation missing");
  });

  test("passes a non-blocking error through with the model's final text", () => {
    const ctx = createRunContext({
      currentError: { message: "tool failed", category: "other" },
      result: { text: "Cannot proceed.", toolCalls: [] },
    });
    const response = phaseFinalize(ctx);
    expect(response.output).toBe("Cannot proceed.");
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

  test("summary active_skills reflects the end-of-turn session set, not the request", () => {
    const events: { event: string; fields?: Record<string, unknown> }[] = [];
    const ctx = createRunContext({
      request: {
        model: "gpt-5-mini",
        message: "test",
        history: [],
        activeSkills: [{ name: "build", instructions: "x" }],
      },
      result: { text: "Done.", toolCalls: [] },
      debug: (event, fields) => events.push({ event, fields }),
    });
    ctx.session.activeSkills = [
      { name: "build", instructions: "x" },
      { name: "tdd", instructions: "y" },
    ];
    phaseFinalize(ctx);
    const summary = events.find((e) => e.event === "lifecycle.summary");
    expect(summary?.fields?.active_skills).toEqual(["build", "tdd"]);
  });
});

describe("parseChatResponse activeSkills", () => {
  test("preserves activeSkills from response", () => {
    const skills = [{ name: "build", instructions: "Build instructions" }];
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      outputStreamed: false,
      activeSkills: skills,
    });
    expect(response?.activeSkills).toEqual(skills);
  });

  test("omits activeSkills when not present", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      outputStreamed: false,
    });
    expect(response?.activeSkills).toBeUndefined();
  });
});
