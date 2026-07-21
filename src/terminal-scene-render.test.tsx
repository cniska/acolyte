import { expect, test } from "bun:test";
import { ChatTranscriptRow } from "./chat-transcript";
import type { TranscriptRow } from "./chat-transcript-contract";
import { TerminalSceneRender } from "./terminal-scene-render";
import { renderToString } from "./tui";
import { stripAnsi } from "./tui/serialize";
import { ansi } from "./tui/styles";
import { renderPlain } from "./tui/test-utils";

test("semantic user and assistant scenes preserve the legacy transcript text", () => {
  const cases: Array<{ kind: "user" | "assistant"; text: string }> = [
    { kind: "user", text: "review this change" },
    { kind: "assistant", text: "A concise `answer` that wraps across the available transcript width." },
  ];
  for (const item of cases) {
    const legacy = renderPlain(
      <ChatTranscriptRow
        row={{ id: `row_${item.kind}`, kind: item.kind, content: item.text }}
        contentWidth={24}
        toolContentWidth={24}
      />,
      26,
    );
    const presentation: TranscriptRow = {
      id: `row_${item.kind}`,
      kind: item.kind,
      lifecycle: "complete",
      content: { kind: "message", text: item.text },
    };
    const scene = renderPlain(
      <ChatTranscriptRow
        row={{ id: `row_${item.kind}`, kind: item.kind, content: item.text }}
        contentWidth={24}
        toolContentWidth={24}
        presentation={presentation}
      />,
      26,
    );
    expect(scene).toBe(legacy);
  }
});

test("renders repeated scene spans without duplicate React keys", () => {
  const errors: unknown[][] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    expect(
      renderPlain(
        <TerminalSceneRender
          scene={{
            lines: [
              { spans: [{ text: "repeat", role: "assistant" }] },
              { spans: [{ text: "repeat", role: "assistant" }] },
            ],
          }}
        />,
      ),
    ).toBe("repeat\nrepeat");
    expect(errors).toEqual([]);
  } finally {
    console.error = error;
  }
});

test("semantic assistant rows retain rich inline-code rendering", () => {
  const content = "Use `code`.";
  const output = renderToString(
    <ChatTranscriptRow
      row={{ id: "row_assistant", kind: "assistant", content }}
      contentWidth={40}
      toolContentWidth={40}
      presentation={{
        id: "row_assistant",
        kind: "assistant",
        lifecycle: "complete",
        content: { kind: "message", text: content },
      }}
    />,
  );
  expect(stripAnsi(output)).toContain("• Use code.");
  expect(stripAnsi(output)).not.toContain("`code`");
  expect(output).toContain(ansi.dim);
});
