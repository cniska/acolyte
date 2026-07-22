import { expect, test } from "bun:test";
import { layoutTranscriptTool } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { renderToString } from "./tui";
import { ansi } from "./tui/styles";
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
  expect(renderPlain(<TerminalSceneRender scene={scene} />, 32)).toStartWith("• Edit");
  expect(renderToString(<TerminalSceneRender scene={scene} />)).toContain(`${ansi.fgRgb(63, 185, 80)}• `);
});

test("semantic skill-toggle tools retain their distinct markers", () => {
  const scene = layoutTranscriptTool({
    parts: [{ kind: "tool-header" as const, labelKey: "tool.label.skill_activate", state: "on" as const }],
    status: "success",
    columns: 32,
  });
  expect(renderPlain(<TerminalSceneRender scene={scene} />, 32)).toStartWith("◉");
});
