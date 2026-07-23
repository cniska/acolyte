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
  expect(scene.lines[0]?.spans[0]?.text).toBe("◇ ");
  expect(scene.lines[1]?.spans.map((span) => span.text).join("")).toBe("");
  expect(scene.lines[2]?.spans.map((span) => span.text).join("")).toBe("❯ next task");
});

test("pending marker and text carry separate roles per kind", () => {
  const marker = (kind: "running" | "queued" | "accepted") =>
    layoutPending({
      presentation: { state: { kind, position: 1 }, frame: 0, startedAt: 0, queuedMessages: [], runningUsage: null },
      now: 0,
      columns: 80,
    }).lines[0]?.spans;

  const running = marker("running");
  expect(running?.[0]?.role).toBe("pending");
  expect(running?.[1]?.role).toBe("pending-shimmer");

  expect(marker("queued")?.[0]?.role).toBe("queued");
  expect(marker("queued")?.[1]?.role).toBe("muted");

  expect(marker("accepted")?.[0]?.role).toBe("accepted");
  expect(marker("accepted")?.[1]?.role).toBe("muted");
});

test("running pending text shimmers with a frame-indexed sweep", () => {
  const bodyRoles = (frame: number) =>
    new Set(
      layoutPending({
        presentation: {
          state: { kind: "running", toolCalls: 0 },
          frame,
          startedAt: 0,
          queuedMessages: [],
          runningUsage: null,
        },
        now: 0,
        columns: 80,
      })
        .lines[0]?.spans.slice(1)
        .map((span) => span.role),
    );

  expect(bodyRoles(0)).toEqual(new Set(["pending-shimmer"]));
  expect(bodyRoles(8).has("pending-shimmer-bright")).toBe(true);
  expect(bodyRoles(8)).not.toEqual(bodyRoles(0));
});
