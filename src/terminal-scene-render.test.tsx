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
  expect(assistant).toContain("◆");
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

test("assistant layout highlights fenced code and preserves whitespace", () => {
  const scene = layoutTranscriptMessage({
    text: "Fix:\n```ts\n  const x = 1\n    nested()\n```",
    kind: "assistant",
    columns: 80,
  });
  expect(scene.lines[0]?.spans).toEqual([
    { text: "◆ ", role: "assistant" },
    { text: "Fix:", role: "assistant" },
  ]);
  // A blank line sets the code block off from the prose (fence markers are stripped).
  expect(scene.lines[1]?.spans).toEqual([{ text: "  ", role: "assistant" }]);
  // Continuation marker, then highlighted code whose spans reconstruct the source line verbatim
  // (leading indentation intact) — code is tokenized, not word-collapsed.
  const codeLine1 = scene.lines[2]?.spans ?? [];
  expect(codeLine1[0]).toEqual({ text: "  ", role: "assistant" });
  expect(
    codeLine1
      .slice(1)
      .map((span) => span.text)
      .join(""),
  ).toBe("  const x = 1");
  expect(codeLine1).toContainEqual({ text: "const", role: "syntax-keyword" });
  expect(codeLine1.slice(1)[0]).toEqual({ text: "  ", role: "syntax-plain" });

  const codeLine2 = scene.lines[3]?.spans ?? [];
  expect(codeLine2[0]).toEqual({ text: "  ", role: "assistant" });
  expect(
    codeLine2
      .slice(1)
      .map((span) => span.text)
      .join(""),
  ).toBe("    nested()");
});

test("assistant layout represents inline markup as semantic spans", () => {
  const scene = layoutTranscriptMessage({
    text: "Use `code`, **bold**, and src/chat.ts:42.",
    kind: "assistant",
    columns: 80,
  });
  expect(scene.lines[0]?.spans).toEqual([
    { text: "◆ ", role: "assistant" },
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
