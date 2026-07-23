import { expect, test } from "bun:test";
import { TerminalSceneViewport } from "./terminal-scene-viewport";
import { renderPlain } from "./test-utils";

test("scene viewport serializes only the fitted live tail", () => {
  const output = renderPlain(
    <TerminalSceneViewport
      constraints={{ columns: 20, rows: 3 }}
      scene={{
        lines: [
          { spans: [{ text: "static", role: "plain" }] },
          { spans: [{ text: "live one", role: "muted" }] },
          { spans: [{ text: "live two", role: "pending" }] },
        ],
        sections: [{ id: "static", lineStart: 0, lineEnd: 1, finalized: true }],
      }}
    />,
    20,
  );
  expect(output).toBe("live one\nlive two");
});
