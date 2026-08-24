import { describe, expect, test } from "bun:test";
import { argNames, MessageSyntaxError, parseMessage } from "./message-parser";

describe("parseMessage", () => {
  test("reads literal text as a single part", () => {
    expect(parseMessage("Status")).toEqual([{ kind: "text", value: "Status" }]);
  });

  test("reads a placeholder between literal text", () => {
    expect(parseMessage("Changed model to {model}.")).toEqual([
      { kind: "text", value: "Changed model to " },
      { kind: "arg", name: "model" },
      { kind: "text", value: "." },
    ]);
  });

  test("reads # inside a plural arm as the count argument", () => {
    expect(parseMessage("{count, plural, one {# file} other {# files}}")).toEqual([
      {
        kind: "plural",
        name: "count",
        arms: {
          one: [
            { kind: "arg", name: "count" },
            { kind: "text", value: " file" },
          ],
          other: [
            { kind: "arg", name: "count" },
            { kind: "text", value: " files" },
          ],
        },
      },
    ]);
  });

  test("reads a plural embedded in surrounding text", () => {
    const parts = parseMessage("{storage} ({count, plural, one {# entry} other {# entries}})");
    expect(parts.map((p) => p.kind)).toEqual(["arg", "text", "plural", "text"]);
    expect(parts.at(-1)).toEqual({ kind: "text", value: ")" });
  });

  test("keeps # outside a plural as literal text", () => {
    expect(parseMessage("issue #42")).toEqual([{ kind: "text", value: "issue #42" }]);
  });

  test("accepts every CLDR plural category", () => {
    const parts = parseMessage("{count, plural, one {#} many {# M} other {#}}");
    expect(Object.keys((parts[0] as { arms: object }).arms).sort()).toEqual(["many", "one", "other"]);
  });
});

describe("parseMessage rejects what the runtime cannot evaluate", () => {
  const rejected: Array<[string, string]> = [
    ["a plural with no other arm", "{count, plural, one {# file}}"],
    ["a nested plural", "{a, plural, other {{b, plural, other {x}}}}"],
    ["an unsupported ICU form", "{gender, select, male {he} other {they}}"],
    ["an unknown plural category", "{count, plural, lots {#} other {#}}"],
    ["an unbalanced open brace", "Hello {name"],
    ["an invalid placeholder name", "Hello {first name}"],
  ];
  for (const [label, input] of rejected) {
    test(`rejects ${label}`, () => {
      expect(() => parseMessage(input)).toThrow(MessageSyntaxError);
    });
  }
});

describe("argNames", () => {
  test("collects placeholders from surrounding text and plural arms", () => {
    expect([...argNames(parseMessage("{storage} ({count, plural, one {# entry} other {# entries}})"))].sort()).toEqual([
      "count",
      "storage",
    ]);
  });

  test("returns nothing for a message with no placeholders", () => {
    expect(argNames(parseMessage("Status")).size).toBe(0);
  });
});
