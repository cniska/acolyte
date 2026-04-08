export function field(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  return key in obj ? (obj as Record<string, unknown>)[key] : undefined;
}
