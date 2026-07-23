import { expect, test } from "bun:test";
import { layoutTranscriptMessage } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { renderToString } from "./tui";
import { stripAnsi } from "./tui/serialize";
import { ansi } from "./tui/styles";
import { renderPlain } from "./tui/test-utils";

test("semantic user and assistant scenes render the transcript text with kind markers", () => {
  const user = renderPlain(
    <TerminalSceneRender scene={layoutTranscriptMessage({ text: "review this change", kind: "user", columns: 26 })} />,
    26,
  );
  expect(user).toContain("❯");
  expect(user).toContain("review this change");

  const assistant = renderPlain(
    <TerminalSceneRender
      scene={layoutTranscriptMessage({
        text: "A concise answer that wraps across the available transcript width.",
        kind: "assistant",
        columns: 26,
      })}
    />,
    26,
  );
  expect(assistant).toContain("•");
  expect(assistant.replace(/\n\s*/g, " ")).toContain("A concise answer that wraps");
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

test("semantic assistant scenes render inline markup as styled spans, not raw markers", () => {
  const content = "Use `code`, **bold**, and src/chat.ts:42.";
  const scene = layoutTranscriptMessage({ text: content, kind: "assistant", columns: 52 });
  const output = renderToString(<TerminalSceneRender scene={scene} />);
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
