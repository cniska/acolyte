import { describe, expect, test } from "bun:test";
import type { CliCommandHelp } from "./cli-contract";
import { commandHelp, createUsageCommandRows, createUsageOptionRows, printLineBreak, printUsage } from "./cli-help";
import { stripAnsi } from "./tui/serialize";

const runHelp: CliCommandHelp = {
  command: "run <prompt>",
  usage: "acolyte run [--file <path>] [--workspace <path>] [--model <id>] <prompt>",
  description: "run a single prompt non-interactively",
  examples: ['acolyte run "summarize README.md"'],
};

const authHelp: CliCommandHelp = {
  command: "auth [provider]",
  usage: "acolyte auth [openai|anthropic|google|vercel]",
  description: "authenticate a provider",
  examples: ["acolyte auth"],
};

const toolHelp: CliCommandHelp = {
  command: "tool",
  usage: "acolyte tool <tool-id> [args...]",
  description: "run a tool directly",
  examples: ['acolyte tool file-find "src/**/*.ts"'],
};

describe("cli-help", () => {
  test("createUsageCommandRows excludes tool and includes core commands", () => {
    const rows = createUsageCommandRows([runHelp, authHelp, toolHelp]);
    expect(rows.some((row) => row.command.startsWith("auth"))).toBe(true);
    expect(rows.some((row) => row.command.startsWith("run"))).toBe(true);
    expect(rows.some((row) => row.command.startsWith("tool"))).toBe(false);
  });

  test("createUsageOptionRows includes help and version options", () => {
    const rows = createUsageOptionRows();
    expect(rows).toEqual([
      { option: "-h, --help", description: "print help" },
      { option: "-V, --version", description: "print version" },
      { option: "--update", description: "check for updates before running" },
      { option: "--no-update", description: "disable update checks" },
    ]);
  });

  test("commandHelp prints usage, description, and examples", () => {
    const lines: string[] = [];
    commandHelp(runHelp, (line) => lines.push(line));
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
      [runHelp, authHelp],
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
