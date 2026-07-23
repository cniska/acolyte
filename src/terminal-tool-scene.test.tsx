import { expect, test } from "bun:test";
import { layoutTranscriptTool } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { renderToString } from "./tui";
import { stripAnsi } from "./tui/serialize";
import { ansi, colorToFg } from "./tui/styles";
import { renderPlain } from "./tui/test-utils";

const parts = [
  { kind: "tool-header" as const, labelKey: "tool.label.file_edit", detail: "src/a-very-long-file-name.ts" },
  {
    kind: "diff" as const,
    marker: "add" as const,
    lineNumber: 12,
    text: "const result = calculateVeryLongValue(input);",
  },
  { kind: "truncated" as const, count: 4, unit: "lines" },
];

test("semantic tool scene renders the tool label and a status-colored marker", () => {
  const scene = layoutTranscriptTool({ parts, status: "success", columns: 32 });
  expect(renderPlain(<TerminalSceneRender scene={scene} />, 32)).toStartWith("◆ Edit");
  expect(renderToString(<TerminalSceneRender scene={scene} />)).toContain(`${colorToFg("green")}◆ `);
});

test("diff-add rows paint the full row width with the tinted band and green text", () => {
  const scene = layoutTranscriptTool({
    parts: [
      { kind: "tool-header" as const, labelKey: "tool.label.file_edit", detail: "src/a.ts" },
      { kind: "diff" as const, marker: "add" as const, lineNumber: 12, text: "const x = 1;" },
    ],
    status: "success",
    columns: 40,
  });
  const output = renderToString(<TerminalSceneRender scene={scene} />);
  const diffLine = stripAnsi(output)
    .split("\n")
    .find((line) => line.includes("12"));
  expect(diffLine).toHaveLength(40);
  expect(output).toContain(ansi.bgRgb(4, 34, 8));
  expect(output).toContain(ansi.fgRgb(74, 154, 74));
  expect(output).not.toContain(colorToFg("white"));
});

test("semantic skill-toggle tools retain their distinct markers", () => {
  const scene = layoutTranscriptTool({
    parts: [{ kind: "tool-header" as const, labelKey: "tool.label.skill_activate", state: "on" as const }],
    status: "success",
    columns: 32,
  });
  expect(renderPlain(<TerminalSceneRender scene={scene} />, 32)).toStartWith("◈");
});
