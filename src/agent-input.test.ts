import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAgentInput, setTokenEncoder } from "./agent-input";
import type { ChatRequest } from "./api";
import { MAX_RECENT_TURNS } from "./lifecycle-constants";
import { defaultLifecyclePolicy } from "./lifecycle-policy";

const defaultOptions = {
  contextMaxTokens: defaultLifecyclePolicy.contextMaxTokens,
};

// Use a deterministic chars/4 estimator so budget tests don't depend on the tiktoken encoding.
const charsPerToken = 4;
beforeAll(() => setTokenEncoder({ encode: (input: string) => ({ length: Math.ceil(input.length / charsPerToken) }) }));
afterAll(() => setTokenEncoder(null));

type HistoryMessage = ChatRequest["history"][number];

function msg(id: string, role: HistoryMessage["role"], content: string, kind?: HistoryMessage["kind"]): HistoryMessage {
  return { id: `msg_${id}`, role, content, kind, timestamp: "2026-02-20T10:00:00.000Z" };
}

function exchange(i: number, extra?: HistoryMessage[]): HistoryMessage[] {
  return [msg(`u${i}`, "user", `USER_${i}`), ...(extra ?? []), msg(`a${i}`, "assistant", `ASSISTANT_${i}`)];
}

function exchanges(count: number): HistoryMessage[] {
  return Array.from({ length: count }, (_, i) => exchange(i)).flat();
}

function req(message: string, history: HistoryMessage[], extras?: Partial<ChatRequest>): ChatRequest {
  return { model: "gpt-5-mini", message, history, ...extras };
}

function createRequest(content: string): ChatRequest {
  return req("review this", [msg("context", "user", content)]);
}

describe("createAgentInput", () => {
  test("includes full message content when budget allows", () => {
    const longSystem = `General note: ${"B".repeat(4000)}`;
    const { input } = createAgentInput(createRequest(longSystem), defaultOptions);
    expect(input).toContain("General note:");
    expect(input).toContain("B".repeat(4000));
    expect(input).not.toContain("…");
  });

  test("includes skill context in input when activeSkills present", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "use repo conventions",
      history: [],
      activeSkills: [{ name: "build", instructions: "keep slices small." }],
    };

    const { input, usage } = createAgentInput(req, defaultOptions);
    expect(input).toContain("SYSTEM: Active skill (build)");
    expect(input).toContain("keep slices small.");
    expect(usage.skillTokens).toBeGreaterThan(0);
    expect(usage.messageTokens).toBeLessThan(usage.inputTokens);
  });

  test("reports provided tool token reservation in usage", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "use tools",
      history: [],
    };

    const { usage } = createAgentInput(req, {
      ...defaultOptions,
      toolTokens: 321,
      systemPromptTokens: 123,
    });
    expect(usage.toolTokens).toBe(321);
    expect(usage.systemPromptTokens).toBe(123);
  });

  test("reports requested system/tool tokens even when they exceed context budget", () => {
    const { input, usage } = createAgentInput(req("continue", [msg("history", "assistant", "HISTORY_SENTINEL")]), {
      ...defaultOptions,
      contextMaxTokens: 100,
      systemPromptTokens: 70,
      toolTokens: 60,
    });
    expect(usage.systemPromptTokens).toBe(70);
    expect(usage.toolTokens).toBe(60);
    expect(input).not.toContain("HISTORY_SENTINEL");
  });

  test("keeps pinned skill context before recent chat when budget is tight", () => {
    const { input } = createAgentInput(
      req("use repo conventions", [msg("user", "user", "x".repeat(10_000))], {
        activeSkills: [{ name: "build", instructions: "keep slices small." }],
      }),
      defaultOptions,
    );
    expect(input).toContain("SYSTEM: Active skill (build)");
    expect(input).toContain("USER: use repo conventions");
  });

  test("respects hard context token budget approximately", () => {
    const { input } = createAgentInput(req("review", exchanges(50)), defaultOptions);
    expect(input.length).toBeLessThanOrEqual(120_000);
    expect(input).toContain("USER: review");
  });

  test("includes full tool payload content when budget allows", () => {
    const toolHeavy = `stdout:\n${"A".repeat(5000)}\nstderr:\n${"B".repeat(2000)}`;
    const { input } = createAgentInput(
      req("continue", [
        msg("tool", "assistant", toolHeavy, "tool_payload"),
        msg("user", "user", "thanks"),
        msg("reply", "assistant", "Ready for the next step."),
      ]),
      defaultOptions,
    );
    expect(input).toContain("A".repeat(5000));
    expect(input).toContain("B".repeat(2000));
    expect(input).toContain("ASSISTANT: Ready for the next step.");
  });

  test("keeps newest oversized history turn by truncating to remaining budget", () => {
    const { input } = createAgentInput(
      req("U".repeat(380), [
        msg("old", "assistant", "older context that should lose to newest turn"),
        msg("new", "assistant", `LATEST ${"x".repeat(4000)}`),
      ]),
      { ...defaultOptions, contextMaxTokens: 120 },
    );
    expect(input).toContain("ASSISTANT: LATEST");
    expect(input).toContain("…");
    expect(input).not.toContain("older context that should lose to newest turn");
  });

  test("prioritizes conversational turns before old tool payloads under tight budget", () => {
    const { input } = createAgentInput(
      req("U".repeat(380), [
        msg("tool", "assistant", `TOOL_SENTINEL ${"A".repeat(5000)}`, "tool_payload"),
        msg("keep1", "assistant", `KEEP_ONE ${"x".repeat(500)}`),
        msg("keep2", "user", `KEEP_TWO ${"y".repeat(500)}`),
      ]),
      { ...defaultOptions, contextMaxTokens: 120 },
    );
    expect(input).toContain("KEEP_TWO");
    expect(input).not.toContain("TOOL_SENTINEL");
  });

  test("excludes turns beyond the window even when budget allows", () => {
    const count = MAX_RECENT_TURNS + 3;
    const { input, usage } = createAgentInput(req("go", exchanges(count)), defaultOptions);
    expect(input).toContain(`USER_${count - 1}`);
    expect(input).toContain(`ASSISTANT_${count - 1}`);
    expect(input).toContain(`USER_${count - MAX_RECENT_TURNS}`);
    expect(input).not.toContain("USER_0");
    expect(input).not.toContain("ASSISTANT_0");
    expect(usage.totalHistoryMessages).toBe(count * 2);
  });

  test("includes tool payloads that belong to a windowed turn", () => {
    const history = [
      ...exchange(99),
      ...exchanges(MAX_RECENT_TURNS - 1),
      ...exchange(MAX_RECENT_TURNS - 1, [msg("tool", "assistant", "TOOL_IN_WINDOW", "tool_payload")]),
    ];
    const { input } = createAgentInput(req("go", history), defaultOptions);
    expect(input).toContain("TOOL_IN_WINDOW");
    expect(input).not.toContain("USER_99");
    expect(input).not.toContain("ASSISTANT_99");
  });

  test("includes all messages when turns are within the window", () => {
    const count = MAX_RECENT_TURNS - 1;
    const { input } = createAgentInput(req("go", exchanges(count)), defaultOptions);
    expect(input).toContain("USER_0");
    expect(input).toContain(`ASSISTANT_${count - 1}`);
  });

  test("windowed messages are still truncated under tight budget", () => {
    const history = Array.from({ length: MAX_RECENT_TURNS }, (_, i) =>
      exchange(i, [msg(`big${i}`, "user", `BIG_${i} ${"x".repeat(50_000)}`)]),
    ).flat();
    const { input } = createAgentInput(req("go", history), { ...defaultOptions, contextMaxTokens: 500 });
    expect(input).toContain("…");
    expect(input).toContain("USER: go");
  });

  test("excludes system and status messages from the window", () => {
    const { input } = createAgentInput(
      req("go", [
        msg("sys", "system", "SYSTEM_NOISE"),
        msg("u0", "user", "ONLY_USER"),
        msg("status", "assistant", "STATUS_NOISE", "status"),
        msg("a0", "assistant", "ONLY_REPLY"),
      ]),
      defaultOptions,
    );
    expect(input).toContain("ONLY_USER");
    expect(input).toContain("ONLY_REPLY");
    expect(input).not.toContain("SYSTEM_NOISE");
    expect(input).not.toContain("STATUS_NOISE");
  });

  test("includes all assistant messages when history has no user messages", () => {
    const { input } = createAgentInput(
      req("go", [
        msg("a0", "assistant", "REPLY_0"),
        msg("a1", "assistant", "REPLY_1"),
        msg("a2", "assistant", "REPLY_2"),
      ]),
      defaultOptions,
    );
    expect(input).toContain("REPLY_0");
    expect(input).toContain("REPLY_1");
    expect(input).toContain("REPLY_2");
  });

  test("totalHistoryMessages reflects full history, not windowed subset", () => {
    const { usage } = createAgentInput(req("go", exchanges(25)), defaultOptions);
    expect(usage.totalHistoryMessages).toBe(50);
  });
});
