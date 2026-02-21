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

  test("strips A/B/C choice scaffolding and keeps core answer", () => {
    const raw = [
      "I can apply the two fixes.",
      "",
      "Pick one:",
      "A — Show dry-run patch.",
      "B — Apply edits and run verify.",
      "C — Skip.",
      "",
      "Reply A, B, or C.",
    ].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe("I can apply the two fixes.");
  });

  test("strips pick-one action prompt line", () => {
    const raw = ["Done reviewing.", "", "Pick one action:"].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe("Done reviewing.");
  });

  test("normalizes A/B/C option lines to numbered options", () => {
    const raw = ["A - first", "B — second", "C) third"].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe(["1. first", "2. second", "3. third"].join("\n"));
  });

  test("normalizes 1) style numbering to 1. style", () => {
    const raw = ["1) first", "2) second"].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe(["1. first", "2. second"].join("\n"));
  });

  test("strips numeric reply scaffolding lines", () => {
    const raw = ["Applied changes.", "", "Reply 1, 2, or 3.", "Which option do you prefer?"].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe("Applied changes.");
  });

  test("strips generic recap lead-in lines", () => {
    const raw = ["Recap: two small fixes.", "", "1) fix null checks", "2) add try/catch"].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe(["1. fix null checks", "2. add try/catch"].join("\n"));
  });

  test("strips quick recap and repo context sections", () => {
    const raw = [
      "Next recommended change: tighten tool error wrapping.",
      "",
      "Quick recap + next step.",
      "",
      "Repo context (from latest status)",
      "- Branch: main (ahead 57)",
      "- Modified files: src/cli.ts",
      "",
      "Pick one action:",
      "A — Show dry-run patch.",
      "B — Apply edits.",
      "C — Skip.",
      "",
      "Reply A, B, or C.",
    ].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe("Next recommended change: tighten tool error wrapping.");
  });

  test("strips quick status and recommendation letter scaffolding", () => {
    const raw = [
      "Ready, Chris.",
      "",
      "Quick status",
      "- Branch: main (ahead 57)",
      "- Modified files: src/cli.ts",
      "",
      "What I found to fix in src/mastra-tools.ts",
      "1) Use null checks for numeric fields.",
      "2) Add execute try/catch context.",
      "",
      "Recommendation — do B",
      "- Apply the edits and run verify.",
    ].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe(
      [
        "What I found to fix in src/mastra-tools.ts",
        "1. Use null checks for numeric fields.",
        "2. Add execute try/catch context.",
      ].join("\n"),
    );
  });

  test("strips quick options capability dump", () => {
    const raw = [
      "Ready.",
      "",
      "Quick options:",
      "- Inspect the repo",
      "- Run tests",
      "- Edit files",
      "",
      "Start with src/mastra-tools.ts null-check fix.",
    ].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe("Start with src/mastra-tools.ts null-check fix.");
  });

  test("strips 'If you want, I can' option scaffolding", () => {
    const raw = [
      "Fix is ready.",
      "",
      "If you want, I can:",
      "- apply the patch",
      "- run verify",
      "",
      "Which do you want?",
    ].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe("Fix is ready.");
  });

  test("caps very long assistant output", () => {
    const raw = `Summary\n${"x".repeat(3000)}`;
    const out = finalizeAssistantOutput(raw);
    expect(out.length).toBeLessThanOrEqual(1400);
    expect(out.endsWith("…")).toBe(true);
  });

  test("strips quick reminders and notes/blockers sections", () => {
    const raw = [
      "Actionable fix: add null checks in read-file snippet.",
      "",
      "Quick reminders:",
      "- inspect repo",
      "- run tests",
      "",
      "Notes / blockers",
      "- none",
      "",
      "Done.",
    ].join("\n");
    expect(finalizeAssistantOutput(raw)).toBe("Actionable fix: add null checks in read-file snippet.\n\nDone.");
  });

  test("dogfood prompt returns one immediate action line", () => {
    const raw = [
      "Immediate action - I will generate a dry-run diff for src/mastra-tools.ts.",
      "",
      "Outcome - you will get the patch.",
      "Validation plan - run verify.",
      "Risk - none.",
    ].join("\n");
    expect(finalizeAssistantOutput(raw, "Dogfood mode:\n- Keep response concise")).toBe(
      "Immediate action: generate a dry-run diff for src/mastra-tools.ts.",
    );
  });

  test("dogfood prompt removes duplicate immediate-action prefixes", () => {
    const raw = "Immediate action: Immediate action — generate a dry-run diff.";
    expect(finalizeAssistantOutput(raw, "Dogfood mode:\n- Keep response concise")).toBe(
      "Immediate action: generate a dry-run diff.",
    );
  });

  test("dogfood prompt strips scaffolding and returns actionable line", () => {
    const raw = [
      "Quick status",
      "- branch clean",
      "Pick one action:",
      "A - show dry-run patch",
      "B - apply edit and run verify",
      "Which option do you want?",
      "1. apply edit and run verify",
    ].join("\n");
    expect(finalizeAssistantOutput(raw, "Dogfood mode:\n- Keep response concise")).toBe(
      "Immediate action: apply edit and run verify",
    );
  });
});

describe("selectAgentRole", () => {
  test("routes review prompts to reviewer", () => {
    expect(selectAgentRole("review @src/agent.ts")).toBe("reviewer");
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
