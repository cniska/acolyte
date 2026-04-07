import { alignCols } from "./chat-format";
import type { CliCommandHelp } from "./cli-contract";
import { t } from "./i18n";

type Print = (text: string) => void;

export function printLineBreak(print: Print): void {
  print("");
}

export function formatUsage(command: string): string {
  return t("cli.help.label.usage", { usage: command });
}

export function commandHelp(doc: CliCommandHelp | undefined, printDim: Print): void {
  if (!doc) return;
  printDim(t("cli.help.label.usage", { usage: doc.usage }));
  printLineBreak(printDim);
  printDim(t("cli.help.label.description", { description: doc.description }));
  if (doc.examples.length === 0) return;
  printLineBreak(printDim);
  printDim(t("cli.help.examples"));
  for (const example of doc.examples) printDim(`  ${example}`);
}

export function commandError(doc: CliCommandHelp | undefined, name: string, printError: Print, message?: string): void {
  printError(message ?? formatUsage(doc?.usage ?? `acolyte ${name}`));
  process.exitCode = 1;
}

export function createUsageCommandRows(docs: CliCommandHelp[]): Array<{ command: string; description: string }> {
  return docs
    .filter((entry) => entry.command !== "tool")
    .map((entry) => ({ command: entry.command, description: entry.description }));
}

export function createUsageOptionRows(): Array<{ option: string; description: string }> {
  return [
    { option: "-h, --help", description: t("cli.help.option.help") },
    { option: "-V, --version", description: t("cli.help.option.version") },
    { option: "--update", description: t("cli.help.option.update") },
    { option: "--no-update", description: t("cli.help.option.no_update") },
  ];
}

export function printUsage(
  version: string,
  docs: CliCommandHelp[],
  printOutput: Print,
  formatCliTitle: (version: string) => string,
): void {
  const commands = createUsageCommandRows(docs);
  const options = createUsageOptionRows();
  const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;
  const whiteBold = (text: string): string => `\x1b[1m\x1b[37m${text}\x1b[39m\x1b[22m`;

  // Align commands and options together so columns share the same width
  const allRows: string[][] = [
    ...commands.map((r) => [r.command, dim(r.description)]),
    ...options.map((r) => [r.option, dim(r.description)]),
  ];
  const aligned = alignCols(allRows);
  const commandLines = aligned.slice(0, commands.length);
  const optionLines = aligned.slice(commands.length);

  printLineBreak(printOutput);
  printOutput(formatCliTitle(version));
  printLineBreak(printOutput);
  printOutput(whiteBold(t("cli.help.section.usage")));
  printOutput("  acolyte");
  printOutput("  acolyte <COMMAND> [ARGS]");
  printLineBreak(printOutput);

  printOutput(whiteBold(t("cli.help.section.commands")));
  for (const line of commandLines) printOutput(`  ${line}`);
  printLineBreak(printOutput);

  printOutput(whiteBold(t("cli.help.section.options")));
  for (const line of optionLines) printOutput(`  ${line}`);
  printLineBreak(printOutput);
}
