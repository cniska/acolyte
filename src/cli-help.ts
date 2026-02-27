import { formatCliTitle, printDim, printError, printOutput } from "./ui";

const SUBCOMMANDS: Record<string, { command: string; usage: string; description: string }> = {
  resume: {
    command: "resume [id-prefix]",
    usage: "acolyte resume [id-prefix]",
    description: "resume previous session",
  },
  run: {
    command: "run <prompt>",
    usage: "acolyte run [--file <path>] [--workspace <path>] [--verify] <prompt>",
    description: "run a single prompt",
  },
  history: { command: "history", usage: "acolyte history", description: "show recent sessions" },
  serve: { command: "serve", usage: "acolyte serve", description: "start the API server" },
  status: { command: "status", usage: "acolyte status", description: "show server status" },
  memory: { command: "memory", usage: "acolyte memory <list|add> [options]", description: "manage memory notes" },
  config: {
    command: "config",
    usage: "acolyte config <list|set|unset> [options]",
    description: "manage local CLI config",
  },
  tool: {
    command: "tool",
    usage: "acolyte tool <find|search|web|fetch|read|git-status|git-diff|run|edit> ...",
    description: "run a tool directly",
  },
};

export function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

export function subcommandHelp(name: string): void {
  const entry = SUBCOMMANDS[name];
  if (entry) {
    printDim(`Usage: ${entry.usage}`);
  }
}

export function subcommandError(name: string, message?: string): void {
  const entry = SUBCOMMANDS[name];
  printError(message ?? `Usage: ${entry?.usage ?? `acolyte ${name}`}`);
  process.exitCode = 1;
}

export function isTopLevelHelpCommand(command: string | undefined): boolean {
  return command === "help" || command === "--help" || command === "-h";
}

export function isTopLevelVersionCommand(command: string | undefined): boolean {
  return command === "version" || command === "--version" || command === "-V";
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

export function usage(version: string): void {
  const commands = buildUsageCommandRows();
  const options = buildUsageOptionRows();
  const sharedPad =
    Math.max(
      commands.reduce((max, row) => Math.max(max, row.command.length), 0),
      options.reduce((max, row) => Math.max(max, row.option.length), 0),
    ) + 2;
  const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;
  const whiteBold = (text: string): string => `\x1b[1m\x1b[37m${text}\x1b[39m\x1b[22m`;

  printOutput("");
  printOutput(formatCliTitle(version));
  printOutput("");
  printOutput(whiteBold("Usage"));
  printOutput("  acolyte");
  printOutput("  acolyte <COMMAND> [ARGS]");
  printOutput("");

  printOutput(whiteBold("Commands"));
  for (const row of commands) {
    printOutput(`  ${row.command.padEnd(sharedPad)}${dim(row.description)}`);
  }
  printOutput("");

  printOutput(whiteBold("Options"));
  for (const row of options) {
    printOutput(`  ${row.option.padEnd(sharedPad)}${dim(row.description)}`);
  }
  printOutput("");
}
