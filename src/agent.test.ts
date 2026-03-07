import { describe, expect, test } from "bun:test";
import { createAgentInput } from "./agent-input";
import { createInstructions, createModeInstructions } from "./agent-instructions";
import { resolveModelProviderState, resolveRunnableModel } from "./agent-model";
import { formatAssistantOutput } from "./agent-output";
import type { ChatRequest } from "./api";
import { appConfig } from "./app-config";

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
      ...Array.from({ length: 120 }, (_, i) => `src/file-${i}.ts`),
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

describe("formatAssistantOutput", () => {
  test("returns fallback when output is empty", () => {
    expect(formatAssistantOutput("   ")).toBe(
      "No output from model. Check /status and server logs, then retry or switch model/provider.",
    );
  });

  test("keeps non-empty output as-is (trimmed)", () => {
    expect(formatAssistantOutput("\n Done \n")).toBe("Done");
  });

  test("keeps long output as-is (no truncation)", () => {
    const raw = `Summary\n${"x".repeat(3000)}`;
    const out = formatAssistantOutput(raw);
    expect(out).toBe(raw);
  });

  test("compresses verbose tool-backed output into a short outcome", () => {
    const raw = [
      "Done — I applied both edits.",
      "",
      "What I changed",
      "- File: scripts/reverse_word.py",
      "- Added flags and examples.",
    ].join("\n");
    const out = formatAssistantOutput(raw, "update script", 2);
    expect(out).toBe("Done — I applied both edits.");
  });

  test("returns tool-executed fallback when output is empty after tool calls", () => {
    expect(formatAssistantOutput("   ", "check status", 2)).toBe(
      "No final response after tool execution. Retry, or check server logs if this repeats.",
    );
  });

  test("returns generic fallback when tool error caused empty output", () => {
    expect(formatAssistantOutput("   ", "check status", 0)).toBe(
      "No output from model. Check /status and server logs, then retry or switch model/provider.",
    );
  });
});

describe("resolveModelProviderState", () => {
  test("marks openai as unavailable without OpenAI credentials on api.openai.com", () => {
    expect(
      resolveModelProviderState("openai/gpt-5-mini", {
        openaiApiKey: undefined,
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toEqual({
      provider: "openai",
      available: false,
    });
  });

  test("maps openai-compatible models to openai provider and stays available without key", () => {
    expect(
      resolveModelProviderState("openai-compatible/qwen2.5-coder", {
        openaiApiKey: undefined,
        openaiBaseUrl: "http://localhost:11434/v1",
      }),
    ).toEqual({
      provider: "openai",
      available: true,
    });
  });

  test("marks anthropic and gemini availability by provider-specific credentials", () => {
    expect(
      resolveModelProviderState("anthropic/claude-sonnet-4", {
        openaiBaseUrl: "https://api.openai.com/v1",
        anthropicApiKey: undefined,
      }),
    ).toEqual({
      provider: "anthropic",
      available: false,
    });

    expect(
      resolveModelProviderState("gemini/gemini-2.5-pro", {
        openaiBaseUrl: "https://api.openai.com/v1",
        googleApiKey: "sk-goog",
      }),
    ).toEqual({
      provider: "gemini",
      available: true,
    });
  });
});

describe("resolveRunnableModel", () => {
  test("returns available when provider has credentials", () => {
    expect(
      resolveRunnableModel("openai/gpt-5-mini", {
        openaiApiKey: "sk-openai",
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: true,
    });
  });

  test("returns unavailable when provider lacks credentials", () => {
    expect(
      resolveRunnableModel("openai/gpt-5-mini", {
        openaiApiKey: undefined,
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: false,
    });
  });
});

describe("createModeInstructions", () => {
  test("work mode includes tool instructions from tool definitions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("scan-code");
    expect(out).toContain("edit-code");
    expect(out).toContain("edit-file");
    expect(out).toContain("create-file");
    expect(out).toContain("run-command");
  });

  test("plan mode includes tool instructions from tool definitions", () => {
    const out = createModeInstructions("plan");
    expect(out).toContain("find-files");
    expect(out).toContain("search-files");
    expect(out).toContain("read-file");
  });

  test("work mode includes discovery tool instructions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("Use `find-files` to locate");
    expect(out).toContain("Use `search-files` to search");
  });

  test("includes preamble lines", () => {
    const code = createModeInstructions("work");
    const explore = createModeInstructions("plan");
    expect(code).toContain("Read the target file once");
    expect(code).toContain("make `read-file` on X your first tool call");
    expect(code).toContain("read fails with ENOENT, stop and report");
    expect(code).toContain("prefer `scan-code` + `edit-code`");
    expect(code).toContain("Trust type signatures");
    expect(explore).toContain("negative-answer tasks");
    expect(explore).toContain("Search first");
  });

  test("verify mode includes verification instructions", () => {
    const out = createModeInstructions("verify");
    expect(out).toContain("Review the changes");
    expect(out).toContain("Report any issues found");
    expect(out).toContain("Do not fix them");
  });

  test("work mode does not include verification instructions", () => {
    const out = createModeInstructions("work");
    expect(out).not.toContain("Review the changes");
  });
});

describe("createInstructions", () => {
  test("includes base instructions for all modes", () => {
    const code = createInstructions("Soul.", "work");
    const explore = createInstructions("Soul.", "plan");
    for (const out of [code, explore]) {
      expect(out).toContain("Soul.");
      expect(out).toContain("Prefer dedicated project tools; use shell only when no dedicated tool exists.");
      expect(out).toContain("Before taking action (tool call, command, or edit), write exactly one sentence");
      expect(out).toContain("Keep tool calls and file changes within the current workspace and the requested scope.");
    }
  });

  test("work mode includes work-specific instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("edit-code");
    expect(out).toContain("AST");
    expect(out).toContain("Read the target file once");
    expect(out).toContain("call `create-file` with full content");
  });

  test("work mode excludes plan-only instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).not.toContain("Search first");
  });

  test("plan mode includes plan-specific instructions", () => {
    const out = createInstructions("Soul.", "plan");
    expect(out).toContain("find-files");
    expect(out).toContain("Batch multiple paths");
  });

  test("plan mode excludes work instructions", () => {
    const out = createInstructions("Soul.", "plan");
    expect(out).not.toContain("edit-code` for multi-location");
    expect(out).not.toContain("Read the target file once");
  });
});
