import { describe, expect, test } from "bun:test";
import {
  buildAgentInput,
  buildSubagentContext,
  canonicalToolId,
  collectToolProgressFromStep,
  createInstructions,
  fallbackToolResultMessages,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  formatEditPreviewFromArgs,
  formatToolProgressMessage,
  isPlanLikeOutput,
  resolveAgentModel,
  resolveModelProviderState,
  resolveRunnableModel,
  selectAgentRole,
} from "./agent";
import type { ChatRequest } from "./api";

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

describe("buildAgentInput", () => {
  test("keeps large attached-file system context", () => {
    const attachment = `Attached file: AGENTS.md\n${"A".repeat(6000)}`;
    const input = buildAgentInput(createRequest(attachment));
    expect(input).toContain("Attached file: AGENTS.md");
    expect(input).toContain("A".repeat(5000));
    expect(input.endsWith("…")).toBe(false);
  });

  test("still truncates non-attachment long messages", () => {
    const longSystem = `General note: ${"B".repeat(4000)}`;
    const input = buildAgentInput(createRequest(longSystem));
    expect(input).toContain("General note:");
    expect(input).toContain("…");
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

    const input = buildAgentInput(req);
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

    const input = buildAgentInput(req);
    expect(input.length).toBeLessThanOrEqual(35_000);
    expect(input).toContain("USER: review");
  });
});

describe("execution intent detection", () => {
  test("isPlanLikeOutput detects planning scaffolding", () => {
    expect(isPlanLikeOutput("Plan: update file then run verify")).toBe(true);
    expect(isPlanLikeOutput("I can apply this in two steps.")).toBe(true);
    expect(isPlanLikeOutput("1. Edit src/cli.ts\n2. Run verify")).toBe(true);
    expect(isPlanLikeOutput("• 1. Edit src/cli.ts\n• 2. Run verify")).toBe(true);
    expect(isPlanLikeOutput("Updated src/cli.ts and tests pass.")).toBe(false);
  });

  test("canonicalToolId maps snake_case and camelCase tool aliases", () => {
    expect(canonicalToolId("edit_file")).toBe("edit-file");
    expect(canonicalToolId("write_file")).toBe("write-file");
    expect(canonicalToolId("runCommand")).toBe("run-command");
    expect(canonicalToolId("execute_command")).toBe("run-command");
    expect(canonicalToolId("web_search")).toBe("web-search");
  });
});

describe("finalizeReviewOutput", () => {
  test("returns fallback when output is empty", () => {
    const raw = "   ";
    expect(finalizeReviewOutput(raw)).toBe(
      "No review output produced. Try narrowing to a file (for example @src/agent.ts) or rephrasing your prompt.",
    );
  });

  test("keeps non-empty output even when request includes @path", () => {
    const raw = "Tools used: search-repo\nEvidence: src/cli.ts:1";
    expect(finalizeReviewOutput(raw, "review @src/")).toBe(raw);
  });

  test("keeps non-empty output as-is (trimmed)", () => {
    const raw = "\n  • 1 findings in @src/mastra-tools.ts\n 1) naming issue \n";
    expect(finalizeReviewOutput(raw)).toBe("• 1 findings in @src/mastra-tools.ts\n 1) naming issue");
  });
});

describe("finalizeAssistantOutput", () => {
  test("returns fallback when output is empty", () => {
    expect(finalizeAssistantOutput("   ")).toBe(
      "No output from model. Check /status and backend logs, then retry or switch model/provider.",
    );
  });

  test("keeps non-empty output as-is (trimmed)", () => {
    expect(finalizeAssistantOutput("\n Done \n")).toBe("Done");
  });

  test("keeps long output as-is (no truncation)", () => {
    const raw = `Summary\n${"x".repeat(3000)}`;
    const out = finalizeAssistantOutput(raw);
    expect(out).toBe(raw);
  });

  test("returns tool-executed fallback when output is empty after tool calls", () => {
    expect(finalizeAssistantOutput("   ", "check status", 2)).toBe(
      "No final response after tool execution. Retry, or check backend logs if this repeats.",
    );
  });

  test("returns tool failure reason for non-edit prompts when no output is produced", () => {
    expect(finalizeAssistantOutput("   ", "check status", 0, "openai quota exceeded")).toBe(
      "No output from model. Last tool error: openai quota exceeded",
    );
  });
});

describe("selectAgentRole", () => {
  test("always routes prompts to coder", () => {
    expect(selectAgentRole("review @src/agent.ts")).toBe("coder");
    expect(selectAgentRole("/review @src/agent.ts")).toBe("coder");
    expect(selectAgentRole("What is in src/mastra-tools.ts?")).toBe("coder");
    expect(selectAgentRole("summarize @src/chat-submit-handler.ts")).toBe("coder");
    expect(selectAgentRole("explain docs/project-plan.md")).toBe("coder");
    expect(selectAgentRole("what next")).toBe("coder");
    expect(selectAgentRole("whats next")).toBe("coder");
    expect(selectAgentRole("ok, what's next for this?")).toBe("coder");
    expect(selectAgentRole("plan rollout steps for memory")).toBe("coder");
    expect(selectAgentRole("/plan rollout steps for memory")).toBe("coder");
    expect(selectAgentRole("implement /resume picker improvements")).toBe("coder");
    expect(
      selectAgentRole(
        "add a short note in docs/project-plan.md under Milestone 2 exit criteria: track delegated slice success/failure ratio weekly",
      ),
    ).toBe("coder");
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

  test("marks openai-compatible models as available without OpenAI key", () => {
    expect(
      resolveModelProviderState("openai-compatible/qwen2.5-coder", {
        openaiApiKey: undefined,
        openaiBaseUrl: "http://localhost:11434/v1",
      }),
    ).toEqual({
      provider: "openai-compatible",
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

describe("resolveAgentModel", () => {
  test("returns requested model when using single-model mode", () => {
    expect(resolveAgentModel("coder", "gpt-5-mini", { coder: "gpt-5-codex" })).toBe("gpt-5-mini");
  });
});

describe("collectToolProgressFromStep", () => {
  test("extracts nested tool calls/results from step payloads", () => {
    const step = {
      stepResult: {
        traces: [
          {
            toolCalls: [{ toolName: "run-command", args: { command: "echo hi" } }],
            toolResults: [{ toolName: "run-command", result: "hi" }],
          },
        ],
      },
    };

    expect(collectToolProgressFromStep(step)).toEqual([
      {
        name: "run-command",
        args: { command: "echo hi" },
        result: "",
      },
      {
        name: "run-command",
        args: {},
        result: "hi",
      },
    ]);
  });
});

describe("resolveRunnableModel", () => {
  test("uses requested model in single-model mode", () => {
    expect(
      resolveRunnableModel("coder", "openai/gpt-5-mini", {
        overrides: { coder: "anthropic/claude-sonnet-4" },
        credentials: {
          openaiApiKey: "sk-openai",
          openaiBaseUrl: "https://api.openai.com/v1",
          anthropicApiKey: undefined,
        },
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: true,
      usedFallback: false,
    });
  });

  test("ignores override even when alternate provider is available", () => {
    expect(
      resolveRunnableModel("coder", "openai/gpt-5-mini", {
        overrides: { coder: "anthropic/claude-sonnet-4" },
        credentials: {
          openaiApiKey: "sk-openai",
          openaiBaseUrl: "https://api.openai.com/v1",
          anthropicApiKey: "sk-ant",
        },
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: true,
      usedFallback: false,
    });
  });

  test("returns unavailable when requested model provider is unavailable", () => {
    expect(
      resolveRunnableModel("coder", "openai/gpt-5-mini", {
        overrides: { coder: "anthropic/claude-sonnet-4" },
        credentials: {
          openaiApiKey: undefined,
          openaiBaseUrl: "https://api.openai.com/v1",
          anthropicApiKey: undefined,
        },
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: false,
      usedFallback: false,
    });
  });
});

describe("buildSubagentContext", () => {
  test("includes goal and context guidance", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "review @src/agent.ts",
      history: [{ id: "1", role: "user", content: "previous", timestamp: "2026-02-20T10:00:00.000Z" }],
    };
    const context = buildSubagentContext("coder", req);
    expect(context).toContain("Agent: Acolyte");
    expect(context).toContain("Goal: review @src/agent.ts");
    expect(context).toContain("Context: 1 history messages; model=gpt-5-mini");
  });

  test("does not add prompt-specific what-next guidance", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "what next",
      history: [],
    };
    const context = buildSubagentContext("coder", req);
    expect(context).not.toContain("return exactly 3 concise numbered next steps");
    expect(context).not.toContain("no lettered options");
  });
});

describe("createInstructions", () => {
  test("enforces tool-first execution guidance", () => {
    const out = createInstructions("Base instructions.");
    expect(out).toContain("Default to tool execution.");
    expect(out).toContain("For requests that create a new file, call `write-file` directly");
    expect(out).toContain("Do not offer variants/options before performing a straightforward artifact request");
    expect(out).toContain("state that the file is missing instead of silently creating a replacement file");
  });

  test("forbids save-as advisory responses", () => {
    const out = createInstructions("Base instructions.");
    expect(out).toContain("Forbidden: replying with 'save this as ...'");
  });
});

describe("formatToolProgressMessage", () => {
  test("formats multi-file file-tool args as comma-separated paths", () => {
    expect(
      formatToolProgressMessage("edit-file", {
        paths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      }),
    ).toBe("Edit src/a.ts, src/b.ts, src/c.ts (+1)");
  });

  test("formats run command with command text", () => {
    expect(formatToolProgressMessage("run-command", { command: "bun run verify" })).toBe("Run bun run verify");
  });
});

describe("formatEditPreviewFromArgs", () => {
  test("returns edited header when path is present", () => {
    expect(formatEditPreviewFromArgs({ path: "src/app.ts" })).toEqual(["Edited src/app.ts"]);
  });

  test("returns empty when path is missing", () => {
    expect(formatEditPreviewFromArgs({})).toEqual([]);
  });
});

describe("fallbackToolResultMessages", () => {
  test("falls back to write preview when write result is empty", () => {
    const out = fallbackToolResultMessages("write-file", { path: "sum.rs", content: "fn main() {}\n" }, []);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain("Wrote sum.rs");
  });

  test("returns existing result messages when present", () => {
    const out = fallbackToolResultMessages("edit-file", { path: "src/a.ts" }, ["Edited src/a.ts"]);
    expect(out).toEqual(["Edited src/a.ts"]);
  });
});
