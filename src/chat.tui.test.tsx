import { describe, expect, test } from "bun:test";
import React from "react";
import { ChatHeader } from "./chat-header";
import { ChatInputPanel } from "./chat-input-panel";
import { palette } from "./palette";
import { dedent } from "./test-factory";
import { renderInkPlain } from "./test-tui";

const DEFAULT_FOOTER_CONTEXT = "~/code/acolyte · main · gpt-5-mini";

function renderInputPanel(overrides: React.ComponentProps<typeof ChatInputPanel> = {}, columns = 96): string {
  return renderInkPlain(
    <ChatInputPanel brandColor={palette.brand} footerContext={DEFAULT_FOOTER_CONTEXT} {...overrides} />,
    columns,
  );
}

describe("chat tui visual regression: header", () => {
  test("renders stable header block", () => {
    const out = renderInkPlain(
      <ChatHeader
        lines={[
          { id: "title", text: "Acolyte", suffix: "", dim: false, brand: true },
          { id: "session", text: "version 0.1.0", dim: false, brand: false },
          { id: "context", text: "session sess_demo1234", dim: true, brand: false },
        ]}
        brandColor={palette.brand}
        logoColor={palette.logo}
        logoEyeColor={palette.logoAccent}
      />,
    );
    expect(out).toBe(dedent(`
     ▗█████▖   Acolyte
    ▟█ ● ● █▙  version 0.1.0
    ▜█▄▄▄▄▄█▛  session sess_demo1234
    `, 2));
  });
});

describe("chat tui visual regression: footer and help", () => {
  test("renders stable footer context row", () => {
    const out = renderInputPanel();
    expect(out).toBe(dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────────────────────
        ? help                                                    ~/code/acolyte · main · gpt-5-mini
    `));
  });

  test("renders stable help pane rows", () => {
    const out = renderInputPanel({ showHelp: true });
    expect(out).toBe(dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────────────────────
        @path               attach file         /remember <text>    save memory
        /new                new session         /memory [scope]     list memories
        /resume <id>        resume session      /tokens             token usage
        /sessions           session history     /skills             skills
        /permissions        permissions         /exit               exit
        /status             server status
    `));
  });

  test("renders stable single-column help pane rows at narrow width", () => {
    const out = renderInputPanel({ showHelp: true }, 80);
    expect(out).toBe(dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────
        @path               attach file
        /new                new session
        /resume <id>        resume session
        /sessions           session history
        /permissions        permissions
        /status             server status
        /remember <text>    save memory
        /memory [scope]     list memories
        /tokens             token usage
        /skills             skills
        /exit               exit
    `));
  });
});
