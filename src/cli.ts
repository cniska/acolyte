#!/usr/bin/env bun
import { parseTopLevelArgs } from "./cli-args";
import { chatModeWithOptions } from "./cli-chat";
import { commands, usage } from "./cli-command-registry";
import { checkAndUpdateOnStartup, updateMode } from "./cli-update";
import { formatVersionWithCommit, resolveCliCommitShort, resolveCliVersion } from "./cli-version";
import { printOutput } from "./ui";

const CLI_VERSION = resolveCliVersion();
const CLI_VERSION_OUTPUT = formatVersionWithCommit(CLI_VERSION, resolveCliCommitShort());

function isTopLevelHelpCommand(command: string | undefined): boolean {
  return command === "help" || command === "--help" || command === "-h";
}

function isTopLevelVersionCommand(command: string | undefined): boolean {
  return command === "version" || command === "--version" || command === "-V";
}

async function main(): Promise<void> {
  const { command, args, update } = parseTopLevelArgs(process.argv.slice(2));

  if (!command) {
    if (update === "force") await updateMode();
    else {
      const updated = await checkAndUpdateOnStartup({ skip: update === "skip" });
      if (updated) return;
    }
    await chatModeWithOptions({ resumeLatest: false });
    return;
  }

  if (isTopLevelHelpCommand(command)) {
    usage(CLI_VERSION);
    return;
  }
  if (isTopLevelVersionCommand(command)) {
    printOutput(CLI_VERSION_OUTPUT);
    return;
  }

  if (update === "force" && command !== "update") {
    await updateMode();
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
