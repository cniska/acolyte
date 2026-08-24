import type { Part, PluralCategory } from "./catalog-contract";

const PLURAL_CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

export class MessageSyntaxError extends Error {
  readonly kind = "message-syntax";
}

/**
 * Parses the supported ICU subset: literal text, {name} arguments, and a
 * {name, plural, ...} form whose arms hold text, # and {name} but no nested
 * plural. Rejecting everything else at build time is what keeps the runtime
 * evaluator a plain walk over parts.
 */
export function parseMessage(input: string): Part[] {
  let i = 0;

  function parseParts(depth: number): Part[] {
    const parts: Part[] = [];
    let text = "";
    const flush = () => {
      if (text) parts.push({ kind: "text", value: text });
      text = "";
    };

    while (i < input.length) {
      const ch = input[i];
      if (ch === "}" && depth > 0) break;
      if (ch === "#" && depth > 0) {
        flush();
        parts.push({ kind: "arg", name: "count" });
        i++;
        continue;
      }
      if (ch !== "{") {
        text += ch;
        i++;
        continue;
      }
      flush();
      i++;
      const close = input.indexOf("}", i);
      const comma = input.indexOf(",", i);
      if (close === -1) throw new MessageSyntaxError("unbalanced { in message");
      if (comma === -1 || comma > close) {
        const name = input.slice(i, close).trim();
        if (!/^[A-Za-z0-9_]+$/.test(name)) throw new MessageSyntaxError(`invalid placeholder "${name}"`);
        parts.push({ kind: "arg", name });
        i = close + 1;
        continue;
      }
      const name = input.slice(i, comma).trim();
      i = comma + 1;
      const kindEnd = input.indexOf(",", i);
      const kind = input.slice(i, kindEnd === -1 ? input.length : kindEnd).trim();
      if (kind !== "plural") throw new MessageSyntaxError(`unsupported ICU form "${kind}" (only plural)`);
      if (depth > 0) throw new MessageSyntaxError("nested plural is not supported");
      i = kindEnd + 1;
      const arms: Partial<Record<PluralCategory, Part[]>> = {};
      while (i < input.length) {
        while (input[i] === " ") i++;
        if (input[i] === "}") {
          i++;
          break;
        }
        const armStart = i;
        while (i < input.length && input[i] !== "{") i++;
        const category = input.slice(armStart, i).trim() as PluralCategory;
        if (!PLURAL_CATEGORIES.includes(category))
          throw new MessageSyntaxError(`unknown plural category "${category}"`);
        i++;
        arms[category] = parseParts(depth + 1);
        if (input[i] !== "}") throw new MessageSyntaxError(`unterminated ${category} arm`);
        i++;
      }
      if (!arms.other) throw new MessageSyntaxError("plural is missing the required other arm");
      parts.push({ kind: "plural", name, arms });
    }
    flush();
    return parts;
  }

  const parts = parseParts(0);
  if (i < input.length) throw new MessageSyntaxError("unbalanced } in message");
  return parts;
}

/** Every placeholder a message reads, including those inside plural arms. */
export function argNames(parts: Part[]): Set<string> {
  const names = new Set<string>();
  for (const part of parts) {
    if (part.kind === "arg") names.add(part.name);
    if (part.kind === "plural") {
      names.add(part.name);
      for (const arm of Object.values(part.arms)) for (const nested of argNames(arm ?? [])) names.add(nested);
    }
  }
  return names;
}
