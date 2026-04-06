import { describe, expect, test } from "bun:test";
import { tokenize } from "./chat-tokenizer";

function kinds(line: string): string[] {
  return tokenize(line).map((t) => t.kind);
}

function texts(line: string): string[] {
  return tokenize(line).map((t) => t.text);
}

describe("tokenize", () => {
  describe("plain text", () => {
    test("plain text returns single token", () => {
      expect(tokenize("hello world")).toEqual([
        { text: "hello", kind: "plain" },
        { text: " ", kind: "plain" },
        { text: "world", kind: "plain" },
      ]);
    });

    test("empty string returns empty array", () => {
      expect(tokenize("")).toEqual([]);
    });

    test("preserves multiple spaces", () => {
      expect(texts("a  b")).toEqual(["a", "  ", "b"]);
    });
  });

  describe("code tokens", () => {
    test("backtick-delimited code", () => {
      const tokens = tokenize("run `bun test` now");
      expect(tokens).toEqual([
        { text: "run", kind: "plain" },
        { text: " ", kind: "plain" },
        { text: "`bun test`", kind: "code" },
        { text: " ", kind: "plain" },
        { text: "now", kind: "plain" },
      ]);
    });

    test("code at start of line", () => {
      expect(kinds("`foo` is good")).toEqual(["code", "plain", "plain", "plain", "plain"]);
    });

    test("code at end of line", () => {
      expect(kinds("use `bar`")).toEqual(["plain", "plain", "code"]);
    });

    test("multiple code spans", () => {
      const tokens = tokenize("`a` and `b`");
      expect(tokens.filter((t) => t.kind === "code").map((t) => t.text)).toEqual(["`a`", "`b`"]);
    });

    test("unmatched backtick is plain text", () => {
      expect(kinds("it`s fine")).not.toContain("code");
    });
  });

  describe("bold tokens", () => {
    test("double-star bold", () => {
      const tokens = tokenize("this is **important** stuff");
      expect(tokens).toEqual([
        { text: "this", kind: "plain" },
        { text: " ", kind: "plain" },
        { text: "is", kind: "plain" },
        { text: " ", kind: "plain" },
        { text: "**important**", kind: "bold" },
        { text: " ", kind: "plain" },
        { text: "stuff", kind: "plain" },
      ]);
    });

    test("bold at start of line", () => {
      expect(kinds("**Note:** read this")).toContain("bold");
    });

    test("bold and code in same line", () => {
      const tokens = tokenize("use **bold** and `code`");
      const tagged = tokens.filter((t) => t.kind !== "plain");
      expect(tagged).toEqual([
        { text: "**bold**", kind: "bold" },
        { text: "`code`", kind: "code" },
      ]);
    });
  });

  describe("path tokens", () => {
    test("file with extension", () => {
      expect(kinds("see chat-content.ts for details")).toContain("path");
    });

    test("relative path", () => {
      expect(kinds("edit src/chat-content.ts")).toContain("path");
    });

    test("path with line number", () => {
      const tokens = tokenize("at src/foo.ts:42");
      expect(tokens.find((t) => t.kind === "path")?.text).toBe("src/foo.ts:42");
    });

    test("@ prefix is not a path", () => {
      expect(kinds("use @src/file.ts")).not.toContain("path");
    });

    test("path inside parentheses", () => {
      const tokens = tokenize("(src/foo.ts)");
      expect(tokens.find((t) => t.kind === "path")?.text).toBe("(src/foo.ts)");
    });

    test("version numbers are not paths", () => {
      expect(kinds("version v0.12.0 released")).not.toContain("path");
      expect(kinds("use 1.5 here")).not.toContain("path");
    });

    test("abbreviations are not paths", () => {
      expect(kinds("i.e. this works")).not.toContain("path");
      expect(kinds("e.g. like this")).not.toContain("path");
    });

    test("proper nouns with dots are not paths", () => {
      expect(kinds("use Node.js for this")).not.toContain("path");
    });
  });

  describe("mixed content", () => {
    test("code, bold, path, and plain in one line", () => {
      const tokens = tokenize("**Fix** `runLifecycle` in src/lifecycle.ts now");
      const tagged = tokens.filter((t) => t.kind !== "plain");
      expect(tagged.map((t) => t.kind)).toEqual(["bold", "code", "path"]);
    });

    test("preserves original text order", () => {
      const joined = texts("a `b` **c** d").join("");
      expect(joined).toBe("a `b` **c** d");
    });
  });
});
