import { describe, expect, test } from "bun:test";
import { collectPolicyCandidates, formatPolicyDistillation, normalizePolicySignal } from "./policy-distill";
import type { Message } from "./types";

function user(content: string): Message {
  return { id: crypto.randomUUID(), role: "user", content, timestamp: "2026-02-21T00:00:00.000Z" };
}

describe("policy distillation", () => {
  test("normalizePolicySignal keeps explicit policy-like prompts", () => {
    expect(normalizePolicySignal("please we should keep output concise")).toBe("keep output concise");
    expect(normalizePolicySignal("can we avoid adding tech debt")).toBe("avoid adding tech debt");
  });

  test("normalizePolicySignal ignores non-policy chatter", () => {
    expect(normalizePolicySignal("hello there")).toBeNull();
    expect(normalizePolicySignal("ok")).toBeNull();
  });

  test("collectPolicyCandidates returns repeated signals", () => {
    const messages: Message[] = [
      user("we should keep output concise"),
      user("please we should keep output concise"),
      user("avoid unnecessary verbosity"),
      user("avoid unnecessary verbosity"),
      user("ship it"),
    ];
    const out = collectPolicyCandidates(messages, 2);
    expect(out).toHaveLength(2);
    expect(out[0]?.normalized).toBe("avoid unnecessary verbosity");
    expect(out[0]?.count).toBe(2);
    expect(out[1]?.normalized).toBe("keep output concise");
    expect(out[1]?.count).toBe(2);
  });

  test("formatPolicyDistillation renders actionable output", () => {
    const text = formatPolicyDistillation(
      [
        {
          normalized: "keep output concise",
          count: 3,
          examples: ["we should keep output concise"],
        },
      ],
      14,
    );
    expect(text).toContain("Scanned 14 sessions.");
    expect(text).toContain("1. keep output concise (3x)");
    expect(text).toContain("Convert accepted items into AGENTS.md rules");
  });
});
