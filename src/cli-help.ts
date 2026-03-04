import type { CliSubcommandDoc } from "./cli-contract";

const SUBCOMMANDS: Record<string, CliSubcommandDoc> = {
  resume: {
    command: "resume [id-prefix]",
    usage: "acolyte resume [id-prefix]",
    description: "resume previous session",
    examples: ["acolyte resume", "acolyte resume sess_abc123"],
  },
  run: {
    command: "run <prompt>",
    usage: "acolyte run [--file <path>] [--workspace <path>] [--verify] <prompt>",
    description: "run a single prompt",
    examples: ['acolyte run "summarize README.md"', 'acolyte run --file src/cli.ts --verify "refactor help text"'],
  },
  init: {
    command: "init [provider]",
    usage: "acolyte init [openai|anthropic|gemini]",
    description: "initialize provider API key",
    examples: ["acolyte init", "acolyte init openai"],
  },
  history: {
    command: "history",
    usage: "acolyte history",
    description: "show recent sessions",
    examples: ["acolyte history"],
  },
  server: {
    command: "server",
    usage: "acolyte server [start|status|stop|restart]",
    description: "manage local API server",
    examples: ["acolyte server start", "acolyte server status", "acolyte server stop", "acolyte server restart"],
  },
  status: {
    command: "status",
    usage: "acolyte status",
    description: "show server status",
    examples: ["acolyte status"],
  },
  memory: {
    command: "memory",
    usage: "acolyte memory <list|add> [options]",
    description: "manage memory notes",
    examples: ["acolyte memory list", 'acolyte memory add --project "prefer bun run verify"'],
  },
  config: {
    command: "config",
    usage: "acolyte config <list|set|unset> [options]",
    description: "manage local CLI config",
    examples: ["acolyte config list", "acolyte config set model gpt-5-mini", "acolyte config unset apiUrl"],
  },
  tool: {
    command: "tool",
    usage: "acolyte tool <find|search|web|fetch|read|git-status|git-diff|run|edit> ...",
    description: "run a tool directly",
    examples: ['acolyte tool find "src/**/*.ts"', 'acolyte tool run "bun run verify"'],
  },
};

type Print = (text: string) => void;

export function printLineBreak(print: Print): void {
  print("");
}

export function subcommandHelp(name: string, printDim: Print): void {
  const entry = SUBCOMMANDS[name];
  if (!entry) return;
  printDim(`Usage: ${entry.usage}`);
  printLineBreak(printDim);
  printDim(`Description: ${entry.description}`);
  if (entry.examples.length === 0) return;
  printLineBreak(printDim);
  printDim("Examples:");
  for (const example of entry.examples) printDim(`  ${example}`);
}

export function subcommandError(name: string, printError: Print, message?: string): void {
  const entry = SUBCOMMANDS[name];
  printError(message ?? `Usage: ${entry?.usage ?? `acolyte ${name}`}`);
  process.exitCode = 1;
}

export function buildUsageCommandRows(): Array<{ command: string; description: string }> {
  return Object.values(SUBCOMMANDS)
    .filter((entry) => entry.command !== "tool")
    .map((entry) => ({ command: entry.command, description: entry.description }));
}

export function buildUsageOptionRows(): Array<{ option: string; description: string }> {
  return [
    { option: "-h, --help", description: "print help" },
    { option: "-V, --version", description: "print version" },
  ];
}

export function printUsage(version: string, printOutput: Print, formatCliTitle: (version: string) => string): void {
  const commands = buildUsageCommandRows();
  const options = buildUsageOptionRows();
  const sharedPad =
    Math.max(
      commands.reduce((max, row) => Math.max(max, row.command.length), 0),
      options.reduce((max, row) => Math.max(max, row.option.length), 0),
    ) + 2;
  const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;
  const whiteBold = (text: string): string => `\x1b[1m\x1b[37m${text}\x1b[39m\x1b[22m`;

  printLineBreak(printOutput);
  printOutput(formatCliTitle(version));
  printLineBreak(printOutput);
  printOutput(whiteBold("Usage"));
  printOutput("  acolyte");
  printOutput("  acolyte <COMMAND> [ARGS]");
  printLineBreak(printOutput);

  printOutput(whiteBold("Commands"));
  for (const row of commands) {
    printOutput(`  ${row.command.padEnd(sharedPad)}${dim(row.description)}`);
  }
  printLineBreak(printOutput);

  printOutput(whiteBold("Options"));
  for (const row of options) {
    printOutput(`  ${row.option.padEnd(sharedPad)}${dim(row.description)}`);
  }
  printLineBreak(printOutput);
}
