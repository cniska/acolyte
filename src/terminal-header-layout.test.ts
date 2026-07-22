import { expect, test } from "bun:test";
import { layoutHeader } from "./terminal-chat-layout";

test("semantic header layout reproduces mascot physical lines", () => {
  const scene = layoutHeader({ title: "Acolyte", version: "0.1.0", sessionId: "sess_demo1234" });
  expect(scene.lines.map((line) => line.spans.map((span) => span.text).join(""))).toEqual([
    "   ▗█████▖   Acolyte",
    "  ▟█ ● ● █▙  version 0.1.0",
    "  ▜█▄▄▄▄▄█▛  session sess_demo1234",
  ]);
  expect(scene.lines[1]?.spans[1]?.role).toBe("header-eyes");
});
