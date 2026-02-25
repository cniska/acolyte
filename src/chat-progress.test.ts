import { describe, expect, test } from "bun:test";
import { createProgressTracker } from "./chat-progress";

describe("chat progress tracker", () => {
  test("groups split tool header/detail lines within one progress batch", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (message) => {
        toolMessages.push(message);
      },
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool" },
      { seq: 2, message: "1 + fn main() {}", kind: "tool" },
      { seq: 3, message: "Deleted sum.rs", kind: "tool" },
    ]);

    expect(toolMessages).toEqual(["Edited sum.rs\n1 + fn main() {}", "Deleted sum.rs"]);
  });

  test("dedupes grouped tool messages by default", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (message) => {
        toolMessages.push(message);
      },
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool" },
      { seq: 2, message: "1 + fn main() {}", kind: "tool" },
    ]);
    tracker.apply([
      { seq: 3, message: "Edited sum.rs", kind: "tool" },
      { seq: 4, message: "1 + fn main() {}", kind: "tool" },
    ]);

    expect(toolMessages).toEqual(["Edited sum.rs\n1 + fn main() {}"]);
  });
});
