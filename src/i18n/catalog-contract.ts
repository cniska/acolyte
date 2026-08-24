/**
 * Shape of a compiled message. Catalogs ship as parsed parts rather than ICU
 * source so the runtime never parses a message format.
 */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export type Part =
  | { kind: "text"; value: string }
  | { kind: "arg"; name: string }
  | { kind: "plural"; name: string; arms: Partial<Record<PluralCategory, Part[]>> };

export type Message = Part[];
