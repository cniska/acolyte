import { describe, expect, test } from "bun:test";
import { ChatInputPanel } from "./chat-input-panel";
import type { PickerState } from "./chat-picker";
import { palette } from "./palette";
import { createSession, dedent } from "./test-utils";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";
import { renderPlain } from "./tui-test-utils";

function renderInputPanelWithPicker(picker: PickerState, columns = DEFAULT_TERMINAL_WIDTH): string {
  return renderPlain(
    <ChatInputPanel
      picker={picker}
      activeSessionId="sess_active"
      brandColor={palette.brand}
      footerContext="~/code/acolyte · main · gpt-5-mini"
      onCursorLine={() => {}}
    />,
    columns,
  );
}

describe("chat picker visual regression", () => {
  test("renders skills picker", () => {
    const out = renderInputPanelWithPicker({
      kind: "skills",
      items: [
        {
          name: "build",
          description: "Implement features incrementally through vertical slices",
          path: "bundled://build",
          source: "bundled" as const,
        },
        {
          name: "debug",
          description: "Debug systematically with structured triage",
          path: "bundled://debug",
          source: "bundled" as const,
        },
      ],
      index: 0,
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Skills

      › build                Implement features incrementally through vertical slices
        debug                Debug systematically with structured triage

      Enter to select · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders resume picker", () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-03-02T00:00:00.000Z").getTime();
    try {
      const out = renderInputPanelWithPicker({
        kind: "resume",
        items: [
          createSession({ id: "sess_active", title: "Current Session", updatedAt: "2026-03-02T00:00:00.000Z" }),
          createSession({ id: "sess_prev", title: "Previous Session", updatedAt: "2026-03-02T00:00:00.000Z" }),
        ],
        index: 1,
        scrollOffset: 0,
      });

      expect(out).toBe(
        dedent(`
        ────────────────────────────────────────────────────────────────────────────────────────────────
        Resume Session

          ● sess_active  Current Session   just now
        ›   sess_prev    Previous Session  just now

        Enter to resume · Esc to close
        ────────────────────────────────────────────────────────────────────────────────────────────────
      `),
      );
    } finally {
      Date.now = realNow;
    }
  });
});
