import { describe, expect, test } from "bun:test";
import { palette } from "./palette";
import { terminalTheme } from "./terminal-theme";

// The scene migration must be visually neutral: roles that replaced legacy React styling
// resolve to the same legacy palette colors until the deliberate facelift changes them.
describe("terminalTheme legacy-palette fidelity", () => {
  test("composer border keeps the dim brand color", () => {
    expect(terminalTheme.styles["composer-border"]).toEqual({ foreground: palette.brand, dim: true });
  });

  test("composer prompt marker is plain, as the legacy Text was", () => {
    expect(terminalTheme.styles["composer-prompt"]).toEqual({});
  });

  test("pending markers match the legacy per-kind marker colors", () => {
    expect(terminalTheme.styles.pending?.foreground).toBe(palette.running);
    expect(terminalTheme.styles.queued?.foreground).toBe(palette.queued);
    expect(terminalTheme.styles.accepted?.foreground).toBe(palette.accepted);
  });

  test("selection and cancelled markers use the brand and cancelled palette colors", () => {
    expect(terminalTheme.styles.selected?.foreground).toBe(palette.brand);
    expect(terminalTheme.styles.cancelled?.foreground).toBe(palette.cancelled);
  });

  test("skill-toggle markers use the brand (on) and dim (off) palette colors", () => {
    expect(terminalTheme.styles["skill-on"]?.foreground).toBe(palette.brand);
    expect(terminalTheme.styles["skill-off"]?.foreground).toBe(palette.dim);
  });

  test("muted text dims the default foreground, as the legacy dimColor did", () => {
    expect(terminalTheme.styles.muted).toEqual({ dim: true });
  });

  test("success and error resolve to the terminal-defined ANSI colors", () => {
    expect(terminalTheme.styles.success?.foreground).toBe(palette.success);
    expect(terminalTheme.styles.error?.foreground).toBe(palette.error);
  });

  test("diff rows keep the legacy background and white text", () => {
    expect(terminalTheme.styles["diff-added"]).toEqual({ foreground: palette.text, background: palette.diffAdd });
    expect(terminalTheme.styles["diff-removed"]).toEqual({ foreground: palette.text, background: palette.diffRemove });
  });
});
