const SEP = /[,\s]+/;

export function parseDebugFlags(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(SEP)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
  );
}

const DEBUG_FLAGS = parseDebugFlags(process.env.ACOLYTE_DEBUG);

export function matchesDebugFlag(flags: Set<string>, flag: string): boolean {
  const normalized = flag.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (flags.has("*")) return true;
  if (flags.has(normalized)) return true;
  for (const pattern of flags) {
    if (!pattern.endsWith("*")) continue;
    const prefix = pattern.slice(0, -1);
    if (prefix.length === 0 || normalized.startsWith(prefix)) return true;
  }
  return false;
}

export function isDebugFlagEnabled(flag: string): boolean {
  return matchesDebugFlag(DEBUG_FLAGS, flag);
}

function normalizeTag(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function matchesAnyDebugFlag(flags: Set<string>, tags: string[]): boolean {
  for (const tag of tags) {
    if (matchesDebugFlag(flags, tag)) return true;
  }
  return false;
}

function stringifyDebugValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export function formatDebugLine(tag: string, fields: Record<string, unknown>): string {
  const parts = Object.entries(fields).map(([key, value]) => `${key}=${stringifyDebugValue(value)}`);
  return `[debug:${tag}] ${parts.join(" ")}`.trimEnd();
}

export type DebugLogger = {
  enabled: (tag: string) => boolean;
  log: (tag: string, fields?: Record<string, unknown>) => void;
};

export function createDebugLogger(options?: {
  scope?: string;
  flags?: Set<string>;
  sink?: (line: string) => void;
}): DebugLogger {
  const scope = normalizeTag(options?.scope);
  const flags = options?.flags ?? DEBUG_FLAGS;
  const sink = options?.sink ?? ((line: string) => process.stderr.write(`${line}\n`));

  const enabled = (tag: string): boolean => {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag) return false;
    const scoped = scope ? `${scope}:${normalizedTag}` : normalizedTag;
    return matchesAnyDebugFlag(flags, [normalizedTag, scoped]);
  };

  const log = (tag: string, fields: Record<string, unknown> = {}): void => {
    if (!enabled(tag)) return;
    const normalizedTag = normalizeTag(tag);
    const scoped = scope ? `${scope}:${normalizedTag}` : normalizedTag;
    sink(formatDebugLine(scoped, fields));
  };

  return { enabled, log };
}
