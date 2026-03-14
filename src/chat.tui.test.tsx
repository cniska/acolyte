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

  test("renders help pane without context", () => {
    const out = renderInputPanel({ showHelp: true });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────────────────────
        @path               attach file             /remember <text>    save memory note
        /new                start new session       /memory [scope]     show memory notes
        /resume <id>        resume session          /usage              show token usage
        /sessions           show sessions           /skills             show skills picker
        /model              change model            /exit               exit chat
        /status             show server status
    `),
    );
  });

  test("renders single-column help pane at narrow width without context", () => {
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
        /usage              show token usage
        /skills             show skills picker
        /exit               exit chat
    `),
    );
  });

  test("hides context when typing", () => {
    const out = renderInputPanel({ value: "hello" });
    expect(out).not.toContain(DEFAULT_FOOTER_CONTEXT);
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
      items: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      filtered: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
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

  test("renders local model picker detail without prefixing the label", () => {
    const picker = {
      kind: "model" as const,
      items: [{ label: "qwen2.5-coder:3b", value: "openai-compatible/qwen2.5-coder:3b", detail: "local" }],
      filtered: [{ label: "qwen2.5-coder:3b", value: "openai-compatible/qwen2.5-coder:3b", detail: "local" }],
      query: "",
      index: 0,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model:

      › qwen2.5-coder:3b     local

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders model picker with query filter", () => {
    const picker = {
      kind: "model" as const,
      items: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      filtered: [{ label: "gpt-5.2", value: "gpt-5.2" }],
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
      items: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
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
    const models = Array.from({ length: 12 }, (_, i) => {
      const label = `model-${String(i + 1).padStart(2, "0")}`;
      return { label, value: label };
    });
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
