import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { ChatHeader } from "./chat-header";
import { ChatInputPanel } from "./chat-input-panel";
import { palette } from "./palette";
import { dedent } from "./test-utils";
import { renderInkPlain } from "./tui-test-utils";

const DEFAULT_FOOTER_CONTEXT = "~/code/acolyte · main";

function renderInputPanel(overrides: ComponentProps<typeof ChatInputPanel> = {}, columns = 96): string {
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
    expect(out).toBe(
      dedent(
        `
     ▗█████▖   Acolyte
    ▟█ ● ● █▙  version 0.1.0
    ▜█▄▄▄▄▄█▛  session sess_demo1234
    `,
        2,
      ),
    );
  });
});

describe("chat tui visual regression: footer and help", () => {
  test("renders stable footer context row", () => {
    const out = renderInputPanel();
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────────────────────
        ? help                                                                 ~/code/acolyte · main
    `),
    );
  });

  test("renders stable help pane rows", () => {
    const out = renderInputPanel({ showHelp: true });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────────────────────
        @path               attach file         /remember <text>    save memory note
        /new                start new session   /memory [scope]     show memory notes
        /resume <id>        resume session      /tokens             show token usage
        /sessions           show sessions       /skills             show skills picker
        /model              change model        /exit               exit chat
        /status             show server status
    `),
    );
  });

  test("renders stable single-column help pane rows at narrow width", () => {
    const out = renderInputPanel({ showHelp: true }, 80);
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────
        @path               attach file
        /new                start new session
        /resume <id>        resume session
        /sessions           show sessions
        /model              change model
        /status             show server status
        /remember <text>    save memory note
        /memory [scope]     show memory notes
        /tokens             show token usage
        /skills             show skills picker
        /exit               exit chat
    `),
    );
  });

  test("renders slash suggestions with selected help and no footer row", () => {
    const out = renderInputPanel({
      value: "/mo",
      slashSuggestions: ["/model", "/model plan", "/model work", "/model verify"],
      slashSuggestionIndex: 1,
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ /mo
      ────────────────────────────────────────────────────────────────────────────────────────────────
        /model
        /model plan
        /model work
        /model verify

        change plan model
    `),
    );
  });
});

describe("chat tui visual regression: model picker", () => {
  test("renders model picker placeholder and typed custom value", () => {
    const basePicker = {
      kind: "model" as const,
      items: [
        { model: "gpt-5-mini", name: "gpt-5-mini", description: "balanced default" },
        { model: "gpt-5", name: "gpt-5", description: "highest quality" },
        { model: "other", name: "other", description: "" },
      ],
      index: 2,
    };

    const empty = renderInputPanel({ picker: { ...basePicker, customModel: "" } });
    expect(empty).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model
      
        gpt-5-mini           balanced default
        gpt-5                highest quality
      › other
      
      Select other to type · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );

    const typed = renderInputPanel({ picker: { ...basePicker, customModel: "anthropic/claude-sonnet-4-5" } });
    expect(typed).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model
      
        gpt-5-mini           balanced default
        gpt-5                highest quality
      › anthropic/claude-sonnet-4-5
      
      Select other to type · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });
});
