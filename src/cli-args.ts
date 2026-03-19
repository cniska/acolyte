export function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

export function parseFlag(args: string[], flag: string | string[]): string | undefined {
  const flags = Array.isArray(flag) ? flag : [flag];
  for (const f of flags) {
    const index = args.indexOf(f);
    if (index >= 0 && index + 1 < args.length) return args[index + 1];
  }
  return undefined;
}

export function hasBoolFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function parseRequiredFlag(args: string[], flag: string, errorMessage: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (!next) throw new Error(errorMessage);
  return next;
}

export function parseRepeatableFlag(args: string[], flag: string, errorMessage: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const next = args[i + 1];
      if (!next) throw new Error(errorMessage);
      values.push(next);
      i++;
    }
  }
  return values;
}

export function parseTailCount(raw: string | undefined, defaultCount = 40): number {
  if (raw === undefined) return defaultCount;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultCount;
}

export function parsePositional(args: string[], flagsWithValues: string[]): string[] {
  const flagSet = new Set(flagsWithValues);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flagSet.has(args[i])) {
      i++;
      continue;
    }
    if (args[i].startsWith("-")) continue;
    positional.push(args[i]);
  }
  return positional;
}
