import { expect, test } from "bun:test";
import { ChatTranscriptRow } from "./chat-transcript";
import type { TranscriptRow } from "./chat-transcript-contract";
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

test("semantic tool scene preserves legacy tool text and uses status markers", () => {
  const row = { id: "row_tool", kind: "tool" as const, content: { parts } };
  const legacy = renderPlain(<ChatTranscriptRow row={row} contentWidth={30} toolContentWidth={30} />, 32);
  const presentation: TranscriptRow = {
    id: "row_tool",
    kind: "tool",
    status: "complete",
    content: { kind: "tool-output", output: { parts } },
  };
  const scene = renderPlain(
    <ChatTranscriptRow row={row} contentWidth={30} toolContentWidth={30} presentation={presentation} />,
    32,
  );
  expect(scene).toBe(legacy);
  const successful: TranscriptRow = { ...presentation, status: "success" };
  expect(
    renderPlain(<ChatTranscriptRow row={row} contentWidth={30} toolContentWidth={30} presentation={successful} />, 32),
  ).toStartWith("• Edit");
  expect(
    renderToString(<ChatTranscriptRow row={row} contentWidth={30} toolContentWidth={30} presentation={successful} />),
  ).toContain(`${ansi.fgRgb(63, 185, 80)}• `);
});
