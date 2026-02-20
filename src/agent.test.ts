import { describe, expect, test } from "bun:test";
import type { ChatRequest } from "./api";
import {
  buildAgentInput,
  compactReviewOutput,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  normalizeReviewOutput,
} from "./agent";

function makeRequest(content: string): ChatRequest {
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
    const input = buildAgentInput(makeRequest(attachment));
    expect(input).toContain("Attached file: AGENTS.md");
    expect(input).toContain("A".repeat(5000));
    expect(input.endsWith("…")).toBe(false);
  });

  test("still truncates non-attachment long messages", () => {
    const longSystem = `General note: ${"B".repeat(4000)}`;
    const input = buildAgentInput(makeRequest(longSystem));
    expect(input).toContain("General note:");
    expect(input).toContain("…");
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
