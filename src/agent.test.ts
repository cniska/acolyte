import { describe, expect, test } from "bun:test";
import {
  canonicalToolId,
  createAgentInput,
  createInstructions,
  createModeInstructions,
  createSubagentContext,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  formatToolHeader,
  isPlanLikeOutput,
  resolveModelProviderState,
  resolveRunnableModel,
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
    expect(canonicalToolId("write_file")).toBe("create-file");
    expect(canonicalToolId("runCommand")).toBe("run-command");
    expect(canonicalToolId("execute_command")).toBe("run-command");
    expect(canonicalToolId("web_search")).toBe("web-search");
    expect(canonicalToolId("editCode")).toBe("edit-code");
    expect(canonicalToolId("edit_code")).toBe("edit-code");
    expect(canonicalToolId("scanCode")).toBe("scan-code");
    expect(canonicalToolId("scan_code")).toBe("scan-code");
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
    const raw = "Tools used: search-files\nEvidence: src/cli.ts:1";
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
      "No output from model. Check /status and server logs, then retry or switch model/provider.",
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
      "No final response after tool execution. Retry, or check server logs if this repeats.",
    );
  });

  test("returns tool failure reason for non-edit prompts when no output is produced", () => {
    expect(finalizeAssistantOutput("   ", "check status", 0, "openai quota exceeded")).toBe(
      "No output from model. Last tool error: openai quota exceeded",
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

describe("createSubagentContext", () => {
  test("includes goal and context guidance", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "review @src/agent.ts",
      history: [{ id: "1", role: "user", content: "previous", timestamp: "2026-02-20T10:00:00.000Z" }],
    };
    const context = createSubagentContext(req);
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
    const context = createSubagentContext(req);
    expect(context).not.toContain("return exactly 3 concise numbered next steps");
    expect(context).not.toContain("no lettered options");
  });
});

describe("createModeInstructions", () => {
  test("code mode includes tool instructions from toolMeta", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("scan-code");
    expect(out).toContain("edit-code");
    expect(out).toContain("edit-file");
    expect(out).toContain("create-file");
    expect(out).toContain("run-command");
  });

  test("explore mode includes tool instructions from toolMeta", () => {
    const out = createModeInstructions("plan");
    expect(out).toContain("find-files");
    expect(out).toContain("search-files");
    expect(out).toContain("read-file");
  });

  test("code mode excludes explore tool instructions", () => {
    const out = createModeInstructions("work");
    // Work mode should not include the dedicated find-files/search-files instructions
    // (though other tools may cross-reference them as alternatives)
    expect(out).not.toContain("Use `find-files` to locate");
    expect(out).not.toContain("Use `search-files` to search");
  });

  test("includes preamble lines", () => {
    const code = createModeInstructions("work");
    const explore = createModeInstructions("plan");
    expect(code).toContain("Read the target file once");
    expect(code).toContain("make `read-file` on X your first tool call");
    expect(code).toContain("first assistant action should be a tool call");
    expect(code).toContain("read fails with ENOENT, stop and report");
    expect(code).toContain("prefer `scan-code` + `edit-code`");
    expect(code).toContain("Trust type signatures");
    expect(explore).toContain("negative-answer tasks");
    expect(explore).toContain("Search first");
  });

  test("verify mode includes verification instructions", () => {
    const out = createModeInstructions("verify");
    expect(out).toContain("verify command");
    expect(out).toContain("confirm it exists in project tooling files");
    expect(out).toContain("fix only files implicated");
    expect(out).toContain("Do not re-read files");
  });

  test("code mode does not include verification instructions", () => {
    const out = createModeInstructions("work");
    expect(out).not.toContain("verify command");
  });
});

describe("createInstructions", () => {
  test("includes base instructions for all modes", () => {
    const code = createInstructions("Soul.", "work");
    const explore = createInstructions("Soul.", "plan");
    for (const out of [code, explore]) {
      expect(out).toContain("Soul.");
      expect(out).toContain("Prefer dedicated tools over shell equivalents");
      expect(out).toContain("Act, don't narrate");
    }
  });

  test("code mode includes code-specific instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("edit-code");
    expect(out).toContain("AST");
    expect(out).toContain("Read the target file once");
    expect(out).toContain("call `create-file` with full content");
  });

  test("code mode excludes explore instructions", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).not.toContain("Use `find-files` to locate files by name");
    expect(out).not.toContain("Search first");
  });

  test("explore mode includes explore-specific instructions", () => {
    const out = createInstructions("Soul.", "plan");
    expect(out).toContain("find-files");
    expect(out).toContain("Batch multiple paths");
  });

  test("explore mode excludes code instructions", () => {
    const out = createInstructions("Soul.", "plan");
    expect(out).not.toContain("edit-code` for multi-location");
    expect(out).not.toContain("Read the target file once");
  });
});

describe("formatToolHeader", () => {
  test("formats multi-file file-tool args as comma-separated paths", () => {
    expect(
      formatToolHeader("edit-file", {
        paths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      }),
    ).toBe("Edit src/a.ts, src/b.ts, src/c.ts (+1)");
  });

  test("formats run command with command text", () => {
    expect(formatToolHeader("run-command", { command: "bun run verify" })).toBe("Run bun run verify");
  });

  test("formats edit-code with file path", () => {
    expect(formatToolHeader("edit-code", { path: "src/agent.ts" })).toBe("Edit src/agent.ts");
  });
});
