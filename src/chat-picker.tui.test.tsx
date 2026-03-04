import { describe, expect, test } from "bun:test";
import { ChatInputPanel } from "./chat-input-panel";
import type { PickerState } from "./chat-picker";
import { palette } from "./palette";
import { createSession, dedent } from "./test-utils";
import { renderInkPlain } from "./tui-test-utils";

function renderInputPanelWithPicker(picker: PickerState, columns = 96): string {
  return renderInkPlain(
    <ChatInputPanel
      picker={picker}
      activeSessionId="sess_active"
      brandColor={palette.brand}
      footerContext="~/code/acolyte · main · gpt-5-mini"
    />,
    columns,
  );
}

describe("chat picker visual regression", () => {
  test("renders skills picker", () => {
    const out = renderInputPanelWithPicker({
      kind: "skills",
      items: [
        { name: "dogfood", description: "Run a quick dogfood loop", path: "/.agents/skills/dogfood/SKILL.md" },
        { name: "refactor", description: "Refactor code safely", path: "/.agents/skills/refactor/SKILL.md" },
      ],
      index: 0,
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Skills
      
      › dogfood              Run a quick dogfood loop
        refactor             Refactor code safely
      
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

  test("renders permissions picker", () => {
    const out = renderInputPanelWithPicker({
      kind: "permissions",
      items: [
        { mode: "read", description: "read-only" },
        { mode: "write", description: "allow edits and commands" },
      ],
      index: 1,
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Permissions
      
        read                 read-only
      › write                allow edits and commands
      
      Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders write-confirm picker", () => {
    const out = renderInputPanelWithPicker({
      kind: "writeConfirm",
      prompt: "edit src/cli.ts to add a new command",
      items: [
        { value: "switch", description: "enable write mode and continue this task" },
        { value: "cancel", description: "keep read mode" },
      ],
      index: 0,
      note: "",
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Confirm Write Access
      
      › switch               enable write mode and continue this task
        cancel               keep read mode
      
      Enter to apply · Esc to cancel
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });
});
