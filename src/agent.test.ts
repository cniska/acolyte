import { describe, expect, test } from "bun:test";
import {
  buildAgentInput,
  buildSubagentContext,
  collectToolProgressFromStep,
  createProgressStageLabel,
  directEditExecutionSatisfied,
  directEditTimeoutMessage,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  formatToolProgressMessage,
  isDirectEditRequest,
  isPlanLikeOutput,
  progressStageForRole,
  resolveAgentModel,
  resolveModelProviderState,
  resolveRunnableModel,
  runAgent,
  selectAgentRole,
  shouldForceRequiredToolsRetry,
  shouldRunPlannerPreface,
} from "./agent";
import type { ChatRequest } from "./api";
import { appConfig, setPermissionMode } from "./app-config";

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
          content: "Active skill (autonomous-feature-delivery): keep slices small.",
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
    expect(input).toContain("SYSTEM: Active skill (autonomous-feature-delivery)");
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
  test("isDirectEditRequest detects imperative edit prompts", () => {
    expect(isDirectEditRequest("add a line break after resume message")).toBe(true);
    expect(isDirectEditRequest("fix the status output")).toBe(true);
    expect(isDirectEditRequest("what next")).toBe(false);
  });

  test("isPlanLikeOutput detects planning scaffolding", () => {
    expect(isPlanLikeOutput("Plan: update file then run verify")).toBe(true);
    expect(isPlanLikeOutput("I can apply this in two steps.")).toBe(true);
    expect(isPlanLikeOutput("1. Edit src/cli.ts\n2. Run verify")).toBe(true);
    expect(isPlanLikeOutput("• 1. Edit src/cli.ts\n• 2. Run verify")).toBe(true);
    expect(isPlanLikeOutput("Updated src/cli.ts and tests pass.")).toBe(false);
  });
});

describe("runAgent guards", () => {
  test("returns immediate read-mode guard for direct edits", async () => {
    const previousMode = appConfig.agent.permissions.mode;
    setPermissionMode("read");
    try {
      const result = await runAgent({
        soulPrompt: "test soul",
        request: {
          model: "gpt-5-mini",
          message: "add a line break before the resume message",
          history: [],
          sessionId: "sess_test",
        },
      });
      expect(result.output).toBe("Edit request blocked in read mode. Use /permissions write, then retry.");
      expect(result.toolCalls ?? []).toHaveLength(0);
    } finally {
      setPermissionMode(previousMode);
    }
  });

  test("blocks direct edit prompts that target absolute paths outside workspace", async () => {
    const previousMode = appConfig.agent.permissions.mode;
    setPermissionMode("write");
    try {
      const result = await runAgent({
        soulPrompt: "test soul",
        request: {
          model: "gpt-5-mini",
          message: "edit /etc/hosts to set x to 2",
          history: [],
          sessionId: "sess_test",
        },
      });
      expect(result.output).toContain("outside allowed roots");
      expect(result.output).toContain("/etc/hosts");
      expect(result.toolCalls ?? []).toHaveLength(0);
    } finally {
      setPermissionMode(previousMode);
    }
  });
});

describe("direct edit execution contract", () => {
  test("requires edit-file tool usage", () => {
    expect(directEditExecutionSatisfied([], "Edited src/cli.ts")).toBe(false);
    expect(directEditExecutionSatisfied(["run-command"], "Done")).toBe(false);
  });

  test("rejects plan-like output even when edit-file is present", () => {
    expect(directEditExecutionSatisfied(["edit-file"], "Plan: update file then run verify")).toBe(false);
  });

  test("accepts concrete output when edit-file was used", () => {
    expect(directEditExecutionSatisfied(["read-file", "edit-file"], "Updated src/cli.ts and applied the change.")).toBe(
      true,
    );
  });
});

describe("directEditTimeoutMessage", () => {
  test("includes generic guidance when paths are unknown", () => {
    expect(directEditTimeoutMessage([])).toContain("Check git diff");
  });

  test("includes edited file path when available", () => {
    expect(directEditTimeoutMessage(["src/cli.ts"])).toContain("src/cli.ts");
  });

  test("uses confirmed wording when edit execution is observed", () => {
    expect(directEditTimeoutMessage(["src/cli.ts"], true)).toContain("edit-file ran");
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

  test("returns edit-specific fallback when output is empty for direct edit prompts", () => {
    expect(finalizeAssistantOutput("   ", "add a line break before resume message")).toBe(
      "Edit request failed: no tools ran. Check /status and retry.",
    );
  });

  test("returns tool failure reason for direct edit prompts when available", () => {
    expect(
      finalizeAssistantOutput(
        "   ",
        "add a line break before resume message",
        0,
        "run-command failed: Shell command execution is disabled in read mode",
      ),
    ).toBe("Edit request failed: run-command failed: Shell command execution is disabled in read mode");
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
  test("routes review prompts to reviewer", () => {
    expect(selectAgentRole("review @src/agent.ts")).toBe("reviewer");
  });

  test("routes read-only file inspection prompts to reviewer", () => {
    expect(selectAgentRole("What is in src/mastra-tools.ts?")).toBe("reviewer");
    expect(selectAgentRole("summarize @src/chat-submit-handler.ts")).toBe("reviewer");
    expect(selectAgentRole("explain docs/project-plan.md")).toBe("reviewer");
  });

  test("routes what-next prompts to default coder role", () => {
    expect(selectAgentRole("what next")).toBe("coder");
    expect(selectAgentRole("whats next")).toBe("coder");
    expect(selectAgentRole("ok, what's next for this?")).toBe("coder");
  });

  test("routes planning prompts to planner", () => {
    expect(selectAgentRole("plan rollout steps for memory")).toBe("planner");
  });

  test("routes implementation prompts to coder by default", () => {
    expect(selectAgentRole("implement /resume picker improvements")).toBe("coder");
  });

  test("does not treat file names containing 'plan' as planning intent", () => {
    expect(
      selectAgentRole(
        "add a short note in docs/project-plan.md under Milestone 2 exit criteria: track delegated slice success/failure ratio weekly",
      ),
    ).toBe("coder");
  });
});

describe("shouldForceRequiredToolsRetry", () => {
  test("requires tool fallback for direct edit requests", () => {
    expect(shouldForceRequiredToolsRetry("coder", true)).toBe(true);
  });

  test("requires tool fallback for reviewer role", () => {
    expect(shouldForceRequiredToolsRetry("reviewer", false)).toBe(true);
  });

  test("does not force tool fallback for normal coder/planner prompts", () => {
    expect(shouldForceRequiredToolsRetry("coder", false)).toBe(false);
    expect(shouldForceRequiredToolsRetry("planner", false)).toBe(false);
  });
});

describe("shouldRunPlannerPreface", () => {
  test("runs planner preface for reviewer prompts", () => {
    expect(shouldRunPlannerPreface("reviewer", false)).toBe(true);
  });

  test("skips planner preface for direct edits and coder/planner prompts", () => {
    expect(shouldRunPlannerPreface("coder", true)).toBe(false);
    expect(shouldRunPlannerPreface("coder", false)).toBe(false);
    expect(shouldRunPlannerPreface("planner", false)).toBe(false);
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
  test("falls back to requested model when no role override is configured", () => {
    expect(resolveAgentModel("planner", "gpt-5-mini", {})).toBe("gpt-5-mini");
  });

  test("uses role override when configured", () => {
    expect(resolveAgentModel("planner", "gpt-5-mini", { planner: "o3" })).toBe("o3");
    expect(resolveAgentModel("coder", "gpt-5-mini", { coder: "gpt-5-codex" })).toBe("gpt-5-codex");
    expect(resolveAgentModel("reviewer", "gpt-5-mini", { reviewer: "gpt-5" })).toBe("gpt-5");
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
  test("falls back to requested model when override provider is unavailable", () => {
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
      usedFallback: true,
    });
  });

  test("keeps override model when its provider is available", () => {
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
      model: "anthropic/claude-sonnet-4",
      provider: "anthropic",
      available: true,
      usedFallback: false,
    });
  });

  test("returns unavailable when both override and requested model providers are unavailable", () => {
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
      model: "anthropic/claude-sonnet-4",
      provider: "anthropic",
      available: false,
      usedFallback: false,
    });
  });
});

describe("buildSubagentContext", () => {
  test("includes role goal and expected output guidance", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "review @src/agent.ts",
      history: [{ id: "1", role: "user", content: "previous", timestamp: "2026-02-20T10:00:00.000Z" }],
    };
    const context = buildSubagentContext("reviewer", req);
    expect(context).toContain("Subagent: Reviewer");
    expect(context).toContain("Goal: review @src/agent.ts");
    expect(context).toContain("Context: 1 history messages; model=gpt-5-mini");
    expect(context).toContain("Expected output:");
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

describe("progressStageForRole", () => {
  test("uses user-facing stage labels with model names", () => {
    expect(progressStageForRole("planner", "openai/o3")).toBe("Planning… (o3)");
    expect(progressStageForRole("coder", "openai/gpt-5-codex")).toBe("Coding… (gpt-5-codex)");
    expect(progressStageForRole("reviewer", "anthropic/claude-sonnet-4")).toBe("Reviewing… (claude-sonnet-4)");
  });
});

describe("createProgressStageLabel", () => {
  test("normalizes known provider prefixes in model labels", () => {
    expect(createProgressStageLabel("coder", "openai-compatible/qwen2.5-coder")).toBe("Coding… (qwen2.5-coder)");
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
