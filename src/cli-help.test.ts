import { describe, expect, test } from "bun:test";
import { buildUsageCommandRows, buildUsageOptionRows, printLineBreak, printUsage, subcommandHelp } from "./cli-help";
import { stripAnsi } from "./tui-test-utils";

describe("cli-help", () => {
  test("buildUsageCommandRows excludes tool and includes core commands", () => {
    const rows = buildUsageCommandRows();
    expect(rows.some((row) => row.command.startsWith("init"))).toBe(true);
    expect(rows.some((row) => row.command.startsWith("run"))).toBe(true);
    expect(rows.some((row) => row.command.startsWith("tool"))).toBe(false);
  });

  test("buildUsageOptionRows includes help and version options", () => {
    const rows = buildUsageOptionRows();
    expect(rows).toEqual([
      { option: "-h, --help", description: "print help" },
      { option: "-V, --version", description: "print version" },
    ]);
  });

  test("subcommandHelp prints usage, description, and examples", () => {
    const lines: string[] = [];
    subcommandHelp("run", (line) => lines.push(line));
    expect(lines.some((line) => line.startsWith("Usage: acolyte run"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Description: run a single prompt"))).toBe(true);
    expect(lines.some((line) => line.includes('acolyte run "summarize README.md"'))).toBe(true);
  });

  test("printLineBreak emits a single empty line", () => {
    const lines: string[] = [];
    printLineBreak((line) => lines.push(line));
    expect(lines).toEqual([""]);
  });

  test("printUsage renders usage sections in order", () => {
    const lines: string[] = [];
    printUsage(
      "0.0.0",
      (line) => lines.push(line),
      (version) => `Acolyte ${version}`,
    );
    const plain = lines.map(stripAnsi);
    expect(plain).toContain("Acolyte 0.0.0");
    expect(plain).toContain("Usage");
    expect(plain).toContain("Commands");
    expect(plain).toContain("Options");
  });
});
