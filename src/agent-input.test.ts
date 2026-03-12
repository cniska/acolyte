import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAgentInput, setTokenEncoder } from "./agent-input";
import type { ChatRequest } from "./api";
import { appConfig } from "./app-config";

// Use a deterministic chars/4 estimator so budget tests don't depend on the tiktoken encoding.
const charsPerToken = 4;
beforeAll(() => setTokenEncoder({ encode: (input: string) => ({ length: Math.ceil(input.length / charsPerToken) }) }));
afterAll(() => setTokenEncoder(null));

function createRequest(content: string): ChatRequest {
  return {
    model: "gpt-5-mini",
    message: "review this",
    history: [
      {
        id: "msg_system",
        role: "system",
        content,
        timestamp: "2026-02-20T10:00:00.000Z",
      },
    ],
  };
}

describe("createAgentInput", () => {
  test("keeps large attached-file system context", () => {
    const attachment = `Attached file: AGENTS.md\n${"A".repeat(6000)}`;
    const { input } = createAgentInput(createRequest(attachment));
    expect(input).toContain("Attached file: AGENTS.md");
    expect(input).toContain("A".repeat(5000));
    expect(input.endsWith("…")).toBe(false);
  });

  test("still truncates non-attachment long messages", () => {
    const longSystem = `General note: ${"B".repeat(4000)}`;
    const { input } = createAgentInput(createRequest(longSystem));
    expect(input).toContain("General note:");
    expect(input).toContain("…");
  });

  test("returns activeSkillName in usage when skill context present", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "use repo conventions",
      history: [
        {
          id: "msg_skill",
          role: "system",
          content: "Active skill (dogfood): keep slices small.",
          timestamp: "2026-02-20T10:00:00.000Z",
        },
      ],
    };

    const { usage } = createAgentInput(req);
    expect(usage.activeSkillName).toBe("dogfood");
    expect(usage.skillInstructionChars).toBe("Active skill (dogfood): keep slices small.".length);
  });

  test("keeps pinned context before recent chat when budget is tight", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "use repo conventions",
      history: [
        {
          id: "msg_skill",
          role: "system",
          content: "Active skill (dogfood): keep slices small.",
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_user",
          role: "user",
          content: "x".repeat(10_000),
          timestamp: "2026-02-20T10:00:01.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req);
    expect(input).toContain("SYSTEM: Active skill (dogfood)");
    expect(input).toContain("USER: use repo conventions");
  });

  test("respects hard context token budget approximately", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "review",
      history: Array.from({ length: 100 }).map((_, index) => ({
        id: `msg_${index}`,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `line-${index} ${"z".repeat(1000)}`,
        timestamp: `2026-02-20T10:00:${String(index).padStart(2, "0")}.000Z`,
      })),
    };

    const { input } = createAgentInput(req);
    expect(input.length).toBeLessThanOrEqual(35_000);
    expect(input).toContain("USER: review");
  });

  test("aggressively compacts older tool-heavy assistant turns", () => {
    const toolHeavy = `stdout:\n${"A".repeat(5000)}\nstderr:\n${"B".repeat(2000)}`;
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "continue",
      history: [
        {
          id: "msg_old_tool",
          role: "assistant",
          content: toolHeavy,
          kind: "tool_payload",
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_old_user",
          role: "user",
          content: "thanks",
          timestamp: "2026-02-20T10:00:01.000Z",
        },
        {
          id: "msg_recent_assistant",
          role: "assistant",
          content: "Ready for the next step.",
          timestamp: "2026-02-20T10:00:02.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req);
    const oldToolLine = input.split("\n").find((line) => line.startsWith("ASSISTANT: stdout:"));
    expect(oldToolLine).toBeDefined();
    expect(oldToolLine?.length).toBeLessThanOrEqual(900);
    expect(input).toContain("ASSISTANT: Ready for the next step.");
  });

  test("does not compact prose that casually mentions stdout", () => {
    const prose = `Summary: We discussed stdout: formatting for status rows.\n${"N".repeat(1100)}TAIL_SENTINEL`;
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "continue",
      history: [
        {
          id: "msg_old_prose",
          role: "assistant",
          content: prose,
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_old_user",
          role: "user",
          content: "thanks",
          timestamp: "2026-02-20T10:00:01.000Z",
        },
        {
          id: "msg_recent_assistant",
          role: "assistant",
          content: "Ready for the next step.",
          timestamp: "2026-02-20T10:00:02.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req);
    expect(input).toContain("TAIL_SENTINEL");
  });

  test("compacts structured search/find tool payload turns", () => {
    const structuredPayload = [
      "scope=workspace patterns=[*.ts] matches=42",
      ...Array.from({ length: 400 }, (_, i) => `src/components/feature-${i}/index.ts`),
      "TAIL_STRUCTURED",
    ].join("\n");
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "continue",
      history: [
        {
          id: "msg_old_structured",
          role: "assistant",
          content: structuredPayload,
          kind: "tool_payload",
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_old_user",
          role: "user",
          content: "thanks",
          timestamp: "2026-02-20T10:00:01.000Z",
        },
        {
          id: "msg_recent_assistant",
          role: "assistant",
          content: "Ready for the next step.",
          timestamp: "2026-02-20T10:00:02.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req);
    const oldStructuredLine = input.split("\n").find((line) => line.startsWith("ASSISTANT: scope=workspace"));
    expect(oldStructuredLine).toBeDefined();
    expect(oldStructuredLine?.length).toBeLessThanOrEqual(900);
    expect(input).not.toContain("TAIL_STRUCTURED");
  });

  test("does not aggressively compact unflagged tool-like assistant content", () => {
    const toolHeavy = `stdout:\n${"A".repeat(5000)}\nstderr:\n${"B".repeat(2000)}\nTAIL_UNFLAGGED`;
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "continue",
      history: [
        {
          id: "msg_old_unflagged",
          role: "assistant",
          content: toolHeavy,
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_old_user",
          role: "user",
          content: "thanks",
          timestamp: "2026-02-20T10:00:01.000Z",
        },
        {
          id: "msg_recent_assistant",
          role: "assistant",
          content: "Ready for the next step.",
          timestamp: "2026-02-20T10:00:02.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req);
    expect(input).toContain("A".repeat(1500));
  });

  test("keeps newest oversized history turn by truncating to remaining budget", () => {
    const originalContextMaxTokens = appConfig.agent.contextMaxTokens;
    (appConfig.agent as { contextMaxTokens: number }).contextMaxTokens = 120;
    try {
      const req: ChatRequest = {
        model: "gpt-5-mini",
        message: "U".repeat(380),
        history: [
          {
            id: "msg_old",
            role: "assistant",
            content: "older context that should lose to newest turn",
            timestamp: "2026-02-20T10:00:00.000Z",
          },
          {
            id: "msg_new",
            role: "assistant",
            content: `LATEST ${"x".repeat(4000)}`,
            timestamp: "2026-02-20T10:00:01.000Z",
          },
        ],
      };

      const { input } = createAgentInput(req);
      expect(input).toContain("ASSISTANT: LATEST");
      expect(input).toContain("…");
      expect(input).not.toContain("older context that should lose to newest turn");
    } finally {
      (appConfig.agent as { contextMaxTokens: number }).contextMaxTokens = originalContextMaxTokens;
    }
  });

  test("prioritizes conversational turns before old tool payloads under tight budget", () => {
    const originalContextMaxTokens = appConfig.agent.contextMaxTokens;
    (appConfig.agent as { contextMaxTokens: number }).contextMaxTokens = 120;
    try {
      const req: ChatRequest = {
        model: "gpt-5-mini",
        message: "U".repeat(380),
        history: [
          {
            id: "msg_old_tool",
            role: "assistant",
            kind: "tool_payload",
            content: `TOOL_SENTINEL ${"A".repeat(5000)}`,
            timestamp: "2026-02-20T10:00:00.000Z",
          },
          {
            id: "msg_keep_1",
            role: "assistant",
            content: `KEEP_ONE ${"x".repeat(500)}`,
            timestamp: "2026-02-20T10:00:01.000Z",
          },
          {
            id: "msg_keep_2",
            role: "user",
            content: `KEEP_TWO ${"y".repeat(500)}`,
            timestamp: "2026-02-20T10:00:02.000Z",
          },
        ],
      };

      const { input } = createAgentInput(req);
      expect(input).toContain("KEEP_TWO");
      expect(input).not.toContain("TOOL_SENTINEL");
    } finally {
      (appConfig.agent as { contextMaxTokens: number }).contextMaxTokens = originalContextMaxTokens;
    }
  });

  test("applies stronger caps for very old tool payload turns", () => {
    const history: ChatRequest["history"] = [
      {
        id: "msg_old_tool",
        role: "assistant",
        kind: "tool_payload",
        content: `stdout:\n${"A".repeat(6000)}\nTAIL_OLD_TOOL`,
        timestamp: "2026-02-20T10:00:00.000Z",
      },
    ];
    for (let i = 1; i <= 12; i += 1) {
      history.push({
        id: `msg_${i}`,
        role: i % 2 === 0 ? "assistant" : "user",
        content: `recent-${i}`,
        timestamp: `2026-02-20T10:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }

    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "continue",
      history,
    };

    const { input } = createAgentInput(req);
    const oldToolLine = input.split("\n").find((line) => line.startsWith("ASSISTANT: stdout:"));
    expect(oldToolLine).toBeDefined();
    expect(oldToolLine?.length).toBeLessThanOrEqual(300);
    expect(input).not.toContain("TAIL_OLD_TOOL");
  });
});
