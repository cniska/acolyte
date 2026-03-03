import { commands } from "./cli-command-registry";
import {
  buildUsageCommandRows as buildUsageCommandRowsFromHelp,
  buildUsageOptionRows as buildUsageOptionRowsFromHelp,
  printUsage,
  subcommandError as subcommandErrorFromHelp,
  subcommandHelp as subcommandHelpFromHelp,
} from "./cli-help";
import { formatCliTitle, printDim, printError, printOutput } from "./ui";

export function subcommandHelp(name: string): void {
  subcommandHelpFromHelp(name, printDim);
}

export function subcommandError(name: string, message?: string): void {
  subcommandErrorFromHelp(name, printError, message);
}

export function buildUsageCommandRows(): Array<{ command: string; description: string }> {
  return buildUsageCommandRowsFromHelp();
}

export function buildUsageOptionRows(): Array<{ option: string; description: string }> {
  return buildUsageOptionRowsFromHelp();
}

export function usage(version: string): void {
  printUsage(version, printOutput, formatCliTitle);
}

export { commands };
