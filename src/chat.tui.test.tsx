import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { ChatHeader } from "./chat-header";
import { ChatInputPanel } from "./chat-input-panel";
import { palette } from "./palette";
import { dedent } from "./test-utils";
import { renderPlain } from "./tui-test-utils";

const DEFAULT_FOOTER_CONTEXT = "~/code/acolyte · main";

function renderInputPanel(overrides: ComponentProps<typeof ChatInputPanel> = {}, columns = 96): string {
  return renderPlain(
    <ChatInputPanel brandColor={palette.brand} footerContext={DEFAULT_FOOTER_CONTEXT} {...overrides} />,
    columns,
  );
}

describe("chat tui visual regression: header", () => {
  test("renders stable header block", () => {
    const out = renderPlain(
      <ChatHeader
        lines={[
          { id: "title", text: "Acolyte", suffix: "", dim: false, brand: true },
          { id: "session", text: "version 0.1.0", dim: false, brand: false },
          { id: "context", text: "session sess_demo1234", dim: true, brand: false },
        ]}
        brandColor={palette.brand}
        mascot={palette.mascot}
        mascotEyes={palette.mascotEyes}
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

  test("renders stable help pane rows with context", () => {
    const out = renderInputPanel({ showHelp: true });
    const lines = out.split("\n");
    const lastLine = lines[lines.length - 1] ?? "";
    // Context should appear as last line, right-aligned
    expect(lastLine).toContain(DEFAULT_FOOTER_CONTEXT);
    expect(lastLine.trimStart()).toBe(DEFAULT_FOOTER_CONTEXT);
    // Help rows should still be present
    expect(out).toContain("@path");
    expect(out).toContain("/exit");
  });

  test("renders stable single-column help pane rows at narrow width with context", () => {
    const out = renderInputPanel({ showHelp: true }, 80);
    const lines = out.split("\n");
    const lastLine = lines[lines.length - 1] ?? "";
    // Context should appear as last line, right-aligned
    expect(lastLine).toContain(DEFAULT_FOOTER_CONTEXT);
    expect(lastLine.trimStart()).toBe(DEFAULT_FOOTER_CONTEXT);
    // Help rows should still be present
    expect(out).toContain("@path");
    expect(out).toContain("/exit");
  });

  test("renders slash suggestions with selected help and no footer row", () => {
    const out = renderInputPanel({
      value: "/mo",
      slashSuggestions: ["/model", "/model work", "/model verify"],
      slashSuggestionIndex: 1,
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ /mo
      ────────────────────────────────────────────────────────────────────────────────────────────────
        /model
        /model work
        /model verify

        change work model
    `),
    );
  });
});

describe("chat tui visual regression: model picker", () => {
  test("renders model picker with selected model", () => {
    const picker = {
      kind: "model" as const,
      items: ["gpt-5-mini", "gpt-5.2"],
      filtered: ["gpt-5-mini", "gpt-5.2"],
      query: "",
      index: 1,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model:

        gpt-5-mini
      › gpt-5.2

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders model picker with query filter", () => {
    const picker = {
      kind: "model" as const,
      items: ["gpt-5-mini", "gpt-5.2"],
      filtered: ["gpt-5.2"],
      query: "5.2",
      index: 0,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model: 5.2

      › gpt-5.2

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders model picker empty state when no matches", () => {
    const picker = {
      kind: "model" as const,
      items: ["gpt-5-mini", "gpt-5.2"],
      filtered: [],
      query: "zzz",
      index: 0,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model: zzz

       No matches.

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders model picker with scroll window", () => {
    const models = Array.from({ length: 12 }, (_, i) => `model-${String(i + 1).padStart(2, "0")}`);
    const picker = {
      kind: "model" as const,
      items: models,
      filtered: models,
      query: "",
      index: 9,
      scrollOffset: 4,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model:

        model-05
        model-06
        model-07
        model-08
        model-09
      › model-10
        model-11
        model-12

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });
});
