import { describe, expect, test } from "bun:test";
import type { ChatRequest } from "./api";
import { buildAgentInput } from "./agent";

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
