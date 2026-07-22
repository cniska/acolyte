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
});
