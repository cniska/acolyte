import { describe, expect, test } from "bun:test";
import { hasHelpFlag, isTopLevelHelpCommand, isTopLevelVersionCommand } from "./cli-command-routing";

describe("cli-command-routing", () => {
  test("hasHelpFlag detects --help, -h, and help", () => {
    expect(hasHelpFlag(["--help"])).toBe(true);
    expect(hasHelpFlag(["-h"])).toBe(true);
    expect(hasHelpFlag(["help"])).toBe(true);
    expect(hasHelpFlag(["--file", "a.ts"])).toBe(false);
    expect(hasHelpFlag([])).toBe(false);
  });

  test("isTopLevelHelpCommand recognizes help variants", () => {
    expect(isTopLevelHelpCommand("help")).toBe(true);
    expect(isTopLevelHelpCommand("--help")).toBe(true);
    expect(isTopLevelHelpCommand("-h")).toBe(true);
    expect(isTopLevelHelpCommand("chat")).toBe(false);
    expect(isTopLevelHelpCommand(undefined)).toBe(false);
  });

  test("isTopLevelVersionCommand recognizes version variants", () => {
    expect(isTopLevelVersionCommand("version")).toBe(true);
    expect(isTopLevelVersionCommand("--version")).toBe(true);
    expect(isTopLevelVersionCommand("-V")).toBe(true);
    expect(isTopLevelVersionCommand("help")).toBe(false);
  });
});
