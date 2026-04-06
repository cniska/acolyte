#!/usr/bin/env bun
import { chatModeWithOptions } from "./cli-chat";
import { commands, usage } from "./cli-command-registry";
import { checkAndUpdateOnStartup } from "./cli-update";
import { formatVersionWithCommit, resolveCliCommitShort, resolveCliVersion } from "./cli-version";
import { printOutput } from "./ui";

const CLI_VERSION = resolveCliVersion();
const CLI_VERSION_OUTPUT = formatVersionWithCommit(CLI_VERSION, resolveCliCommitShort());

const SKIP_UPDATE_COMMANDS = new Set(["help", "--help", "-h", "version", "--version", "-V", "update"]);

function isTopLevelHelpCommand(command: string | undefined): boolean {
  return command === "help" || command === "--help" || command === "-h";
}

function isTopLevelVersionCommand(command: string | undefined): boolean {
  return command === "version" || command === "--version" || command === "-V";
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!SKIP_UPDATE_COMMANDS.has(command ?? "")) {
    const updated = await checkAndUpdateOnStartup();
    if (updated) return;
  }

  if (isTopLevelHelpCommand(command)) {
    usage(CLI_VERSION);
    return;
  }
  if (isTopLevelVersionCommand(command)) {
    printOutput(CLI_VERSION_OUTPUT);
    return;
  }

  if (!command) {
    await chatModeWithOptions({ resumeLatest: false });
    return;
  }

  const handler = commands[command];
  if (handler) {
    await handler(args);
    return;
  }

  usage(CLI_VERSION);
  process.exitCode = 1;
}

if (import.meta.main) await main();
