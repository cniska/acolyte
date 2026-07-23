import { expect, test } from "bun:test";
import { layoutTranscriptTool } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import type { ToolOutputPart } from "./tool-output-contract";
import { fitLine, layoutToolOutput } from "./tool-output-layout";
import { renderToolOutput } from "./tool-output-render";
import { renderPlain } from "./tui/test-utils";

const columns = 32;
const contentWidth = columns - 2;
const parts: ToolOutputPart[] = [
  { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "src/a-very-long-file-name.ts" },
  { kind: "diff", marker: "add", lineNumber: 12, text: "const result = calculateVeryLongValue(input);" },
  { kind: "diff", marker: "remove", lineNumber: 13, text: "const result = oldValue;" },
  { kind: "truncated", count: 4, unit: "lines" },
];

function semanticLines(): string[] {
  return layoutToolOutput(parts).map((line) => {
    const fitted = fitLine(line, contentWidth);
    return `${" ".repeat(fitted.indent)}${fitted.segments
      .filter((segment) => segment.role !== "stream-tag")
      .map((segment) => segment.text)
      .join("")}`;
  });
}

test("CLI and chat project the same semantic tool layout", () => {
  const lines = semanticLines();
  expect(renderToolOutput(parts, contentWidth)).toBe(lines.join("\n"));
  const scene = layoutTranscriptTool({ parts, status: "complete", columns });
  expect(renderPlain(<TerminalSceneRender scene={scene} />, columns)).toBe(
    `◆ ${lines[0]}\n${lines
      .slice(1)
      .map((line) => `  ${line}`)
      .join("\n")}`,
  );
});
