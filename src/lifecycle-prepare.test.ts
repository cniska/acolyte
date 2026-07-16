import { describe, expect, test } from "bun:test";
import type { ChatRequest } from "./api";
import { addActiveSkill } from "./chat-skill-activator";
import { MAX_RECENT_TURNS } from "./lifecycle-constants";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";

function historyExceedingWindow(): ChatRequest["history"] {
  return Array.from({ length: MAX_RECENT_TURNS + 2 }, (_, i) => [
    { id: `u${i}`, role: "user" as const, content: `USER_${i}`, timestamp: "2026-02-20T10:00:00.000Z" },
    { id: `a${i}`, role: "assistant" as const, content: `ASSISTANT_${i}`, timestamp: "2026-02-20T10:00:00.000Z" },
  ]).flat();
}

describe("phasePrepare", () => {
  test("applies lifecycle policy to tool session context", () => {
    const policy = {
      ...defaultLifecyclePolicy,
      toolTimeoutMs: 1_234,
    };
    const prepared = phasePrepare({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      workspace: undefined,
      taskId: "task_test0001",
      soulPrompt: "",
      model: "gpt-5-mini",
      policy,
      debug: () => {},
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    expect(prepared.session.toolTimeoutMs).toBe(1_234);
    expect(prepared.promptUsage.toolTokens).toBeGreaterThan(0);
    expect(prepared.promptUsage.messageTokens).toBe(prepared.promptUsage.inputTokens);
  });

  test("counts project rules in system prompt tokens", () => {
    const base = phasePrepare({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      workspace: undefined,
      taskId: "task_base",
      soulPrompt: "Soul.",
      model: "gpt-5-mini",
      policy: defaultLifecyclePolicy,
      debug: () => {},
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    const withRules = phasePrepare({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      workspace: undefined,
      taskId: "task_rules",
      soulPrompt: "Soul.",
      projectRulesPrompt: "Project rules.",
      model: "gpt-5-mini",
      policy: defaultLifecyclePolicy,
      debug: () => {},
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    expect(withRules.promptUsage.systemPromptTokens).toBeGreaterThan(base.promptUsage.systemPromptTokens);
  });

  test("emits lifecycle.window.drop when the window rolls", () => {
    const events: { event: string; fields?: Record<string, unknown> }[] = [];
    phasePrepare({
      request: { model: "gpt-5-mini", message: "go", history: historyExceedingWindow() },
      workspace: undefined,
      taskId: "task_drop",
      soulPrompt: "",
      model: "gpt-5-mini",
      policy: defaultLifecyclePolicy,
      debug: (event, fields) => events.push({ event, fields }),
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    const drop = events.find((e) => e.event === "lifecycle.window.drop");
    expect(drop).toBeDefined();
    expect(drop?.fields?.dropped_turns).toBe(2);
    expect(drop?.fields?.tokens_idle_at_drop).toBeGreaterThan(0);
    expect(drop?.fields?.kept_history_tokens).toBeGreaterThan(0);
    expect(drop?.fields?.missing_turns).toBe(2);
  });

  test("seeds session activeSkills from the request", () => {
    const activeSkills = [{ name: "build", instructions: "slice it" }];
    const prepared = phasePrepare({
      request: { model: "gpt-5-mini", message: "go", history: [], activeSkills },
      workspace: undefined,
      taskId: "task_seed",
      soulPrompt: "",
      model: "gpt-5-mini",
      policy: defaultLifecyclePolicy,
      debug: () => {},
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    expect(prepared.session.activeSkills).toEqual(activeSkills);
    expect(prepared.session.activeSkills).not.toBe(activeSkills);
  });

  test("activating a skill merges onto the seeded set instead of dropping it", () => {
    const prepared = phasePrepare({
      request: {
        model: "gpt-5-mini",
        message: "go",
        history: [],
        activeSkills: [{ name: "build", instructions: "slice it" }],
      },
      workspace: undefined,
      taskId: "task_merge",
      soulPrompt: "",
      model: "gpt-5-mini",
      policy: defaultLifecyclePolicy,
      debug: () => {},
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    addActiveSkill(prepared.session, { name: "tdd", instructions: "red green" });
    expect(prepared.session.activeSkills?.map((s) => s.name)).toEqual(["build", "tdd"]);
  });

  test("leaves session activeSkills unset when the request has none", () => {
    const prepared = phasePrepare({
      request: { model: "gpt-5-mini", message: "go", history: [] },
      workspace: undefined,
      taskId: "task_noskills",
      soulPrompt: "",
      model: "gpt-5-mini",
      policy: defaultLifecyclePolicy,
      debug: () => {},
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    expect(prepared.session.activeSkills).toBeUndefined();
  });

  test("does not emit lifecycle.window.drop when history fits the window", () => {
    const events: string[] = [];
    phasePrepare({
      request: { model: "gpt-5-mini", message: "go", history: [] },
      workspace: undefined,
      taskId: "task_nodrop",
      soulPrompt: "",
      model: "gpt-5-mini",
      policy: defaultLifecyclePolicy,
      debug: (event) => events.push(event),
      onOutput: () => {},
      onChecklist: () => {},
      mcpListings: [],
    });
    expect(events).not.toContain("lifecycle.window.drop");
  });
});
