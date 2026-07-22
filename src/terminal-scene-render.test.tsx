import { expect, test } from "bun:test";
import { ChatTranscriptRow } from "./chat-transcript";
import type { TranscriptRow } from "./chat-transcript-contract";
import { layoutTranscriptMessage } from "./terminal-chat-layout";
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
      status: "complete",
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

test("semantic assistant scenes preserve legacy inline rendering", () => {
  const content = "Use `code`, **bold**, and src/chat.ts:42.";
  const legacy = renderPlain(
    <ChatTranscriptRow
      row={{ id: "row_assistant", kind: "assistant", content }}
      contentWidth={50}
      toolContentWidth={50}
    />,
    52,
  );
  const scene = layoutTranscriptMessage({ text: content, kind: "assistant", columns: 52 });
  const output = renderToString(<TerminalSceneRender scene={scene} />);
  expect(renderPlain(<TerminalSceneRender scene={scene} />, 52)).toBe(legacy);
  expect(stripAnsi(output)).not.toContain("`code`");
  expect(stripAnsi(output)).not.toContain("**bold**");
  expect(output).toContain(ansi.dim);
  expect(output).toContain(ansi.bold);
});

test("assistant layout represents inline markup as semantic spans", () => {
  const scene = layoutTranscriptMessage({
    text: "Use `code`, **bold**, and src/chat.ts:42.",
    kind: "assistant",
    columns: 80,
  });
  expect(scene.lines[0]?.spans).toEqual([
    { text: "• ", role: "assistant" },
    { text: "Use", role: "assistant" },
    { text: " ", role: "assistant" },
    { text: "code", role: "assistant-code" },
    { text: ",", role: "assistant" },
    { text: " ", role: "assistant" },
    { text: "bold", role: "assistant-bold" },
    { text: ",", role: "assistant" },
    { text: " ", role: "assistant" },
    { text: "and", role: "assistant" },
    { text: " ", role: "assistant" },
    { text: "src/chat.ts:42.", role: "assistant-path" },
  ]);
});
