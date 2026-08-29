import { expect, test } from "bun:test";
import { layoutTranscriptEffect, layoutTranscriptTool } from "./terminal-chat-layout";
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
  const scene = layoutTranscriptTool({ parts, status: "success", columns: 32, now: 0, animating: false });
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
    now: 0,
    animating: false,
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
    now: 0,
    animating: false,
  });
  expect(renderPlain(<TerminalSceneRender scene={scene} />, 32)).toStartWith("◈");
});

test("a running tool alternates between hollow and fisheye as the clock advances", () => {
  const markerAt = (now: number) =>
    renderPlain(
      <TerminalSceneRender
        scene={layoutTranscriptTool({
          parts: [{ kind: "tool-header" as const, labelKey: "tool.label.shell_run", detail: "bun test" }],
          status: "active",
          columns: 32,
          now,
          animating: true,
        })}
      />,
      32,
    ).slice(0, 1);

  expect(markerAt(0)).toBe("◈");
  expect(markerAt(500)).toBe("◇");
  expect(markerAt(1000)).toBe("◈");
});

test("a settled tool keeps the filled marker whatever the clock says", () => {
  const markerAt = (now: number) =>
    renderPlain(
      <TerminalSceneRender
        scene={layoutTranscriptTool({
          parts: [{ kind: "tool-header" as const, labelKey: "tool.label.shell_run", detail: "bun test" }],
          status: "success",
          columns: 32,
          now,
          animating: true,
        })}
      />,
      32,
    ).slice(0, 1);

  expect(markerAt(0)).toBe("◆");
  expect(markerAt(500)).toBe("◆");
});

test("an effect row is dim and settled, never a phase glyph", () => {
  const scene = layoutTranscriptEffect({
    row: {
      effect: "format",
      command: "biome check --write src/a.ts",
      output: [{ kind: "shell-output" as const, stream: "stderr" as const, text: "Fixed 1 file." }],
    },
    columns: 48,
  });
  const plain = renderPlain(<TerminalSceneRender scene={scene} />, 48);
  expect(plain).toStartWith("◆ Effect biome check --write src/a.ts");
  expect(plain).toContain("Fixed 1 file.");
});
