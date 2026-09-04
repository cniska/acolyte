import { expect, test } from "bun:test";
import { layoutHeader } from "./terminal-chat-layout";

test("semantic header layout reproduces mark physical lines", () => {
  const scene = layoutHeader({ title: "Acolyte", version: "0.1.0", sessionId: "sess_demo1234" });
  expect(
    scene.lines.map((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .trimEnd(),
    ),
  ).toEqual([
    "⠙⣿⣆⠀⠀⠀⠀⠀⣾⠿⠿⢿⣷⣄  Acolyte",
    "⠀⠈⢿⣧⡀⠀⠀⢀⣤⣤⣤⣤⣿⣿  version 0.1.0",
    "⠀⢀⣾⡟⠁⠀⠀⣿⣿⠋⠁⢀⣿⣿  session sess_demo1234",
    "⣠⣿⠏⠀⠀⠀⠀⠹⢿⣷⣶⠞⣿⣿",
  ]);
});

test("the chevron and the letter carry different roles so each takes its own color", () => {
  const scene = layoutHeader({ title: "Acolyte", version: "0.1.0", sessionId: "sess_demo1234" });
  expect(scene.lines[0]?.spans[0]?.role).toBe("header-mark");
  expect(scene.lines[0]?.spans[2]?.role).toBe("header-brand");
});
