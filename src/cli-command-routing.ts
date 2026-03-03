export function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

export function isTopLevelHelpCommand(command: string | undefined): boolean {
  return command === "help" || command === "--help" || command === "-h";
}

export function isTopLevelVersionCommand(command: string | undefined): boolean {
  return command === "version" || command === "--version" || command === "-V";
}
