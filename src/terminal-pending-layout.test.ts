import { expect, test } from "bun:test";
import { layoutPending } from "./terminal-chat-layout";

test("pending layout carries running details, blink frame, and queued rows", () => {
  const scene = layoutPending({
    presentation: {
      state: { kind: "running", toolCalls: 2 },
      frame: 9,
      startedAt: 0,
      queuedMessages: ["next task"],
      runningUsage: { inputTokens: 10, outputTokens: 2 },
    },
    now: 65_000,
    columns: 80,
  });
  expect(scene.lines[0]?.spans.map((span) => span.text).join("")).toContain("Working… (1m 5s · 2 tools · ↑10 ↓2)");
  expect(scene.lines[0]?.spans[0]?.text).toBe("  ");
  expect(scene.lines[1]?.spans.map((span) => span.text).join("")).toBe("❯ next task");
});
