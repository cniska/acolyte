import { expect, test } from "bun:test";
import { ChatTranscriptRow } from "./chat-transcript";
import type { TranscriptRow } from "./chat-transcript-contract";
import { renderPlain } from "./tui/test-utils";

test("semantic user and assistant scenes preserve the legacy transcript text", () => {
  const cases: Array<{ kind: "user" | "assistant"; text: string }> = [
    { kind: "user", text: "review this change" },
    { kind: "assistant", text: "A concise answer that wraps across the available transcript width." },
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
