export function unreachable(value: never): never {
  throw new Error(`Unreachable: ${String(value)}`);
}

export function invariant(condition: unknown, message = "Invariant violation"): asserts condition {
  if (!condition) throw new Error(message);
}
