import { describe, expect, test } from "bun:test";
import {
  buildAgentInput,
  buildSubagentContext,
  compactReviewOutput,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  normalizeReviewOutput,
  resolveAgentModel,
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

describe("compactReviewOutput", () => {
  test("keeps short review output as-is", () => {
    const short = "Summary: looks good.";
    expect(compactReviewOutput(short)).toBe(short);
  });

  test("truncates very long review output", () => {
    const long = `Summary\n${"A".repeat(3000)}`;
    const compact = compactReviewOutput(long);
    expect(compact.length).toBeLessThanOrEqual(1800);
    expect(compact.endsWith("…")).toBe(true);
  });
});

describe("normalizeReviewOutput", () => {
  test("normalizes findings header and removes @ prefix in scope", () => {
    const raw = "• 2 findings in @src/mastra-tools.ts";
    expect(normalizeReviewOutput(raw)).toBe("2 findings in src/mastra-tools.ts");
  });

  test("normalizes numbered lines to dotted form and left aligns", () => {
    const raw = ["  1) First issue", "    2. Second issue"].join("\n");
    expect(normalizeReviewOutput(raw)).toBe(["1. First issue", "2. Second issue"].join("\n"));
  });
});

describe("finalizeReviewOutput", () => {
  test("returns fallback when normalized output is empty", () => {
    const raw = "Tools used: search-repo\nEvidence: src/cli.ts:1";
    expect(finalizeReviewOutput(raw)).toBe(
      "No review output produced. Try narrowing to a file (for example @src/agent.ts) or rephrasing your prompt.",
    );
  });

  test("returns scope-aware fallback when request includes @path", () => {
    const raw = "Tools used: search-repo\nEvidence: src/cli.ts:1";
    expect(finalizeReviewOutput(raw, "review @src/")).toBe(
      "No review output produced for @src/. Try narrowing the scope (for example @src/agent.ts) or rephrasing your prompt.",
    );
  });

  test("keeps meaningful normalized output", () => {
    const raw = "• 1 findings in @src/mastra-tools.ts\n 1) naming issue";
    expect(finalizeReviewOutput(raw)).toBe("1 finding in src/mastra-tools.ts\n1. naming issue");
  });
});

describe("finalizeAssistantOutput", () => {
  test("returns fallback when output is empty", () => {
    expect(finalizeAssistantOutput("   ")).toBe("No output produced. Try rephrasing your prompt.");
  });

  test("keeps non-empty output", () => {
    expect(finalizeAssistantOutput("Done")).toBe("Done");
  });
});

describe("selectAgentRole", () => {
  test("routes review prompts to reviewer", () => {
    expect(selectAgentRole("review @src/agent.ts")).toBe("reviewer");
  });

  test("routes planning prompts to planner", () => {
    expect(selectAgentRole("plan rollout steps for memory")).toBe("planner");
  });

  test("routes implementation prompts to coder by default", () => {
    expect(selectAgentRole("implement /resume picker improvements")).toBe("coder");
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
});
