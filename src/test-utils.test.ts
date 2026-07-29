import { describe, expect, test } from "bun:test";
import {
  dedent,
  dedentString,
  expectIntent,
  expectToThrowJSON,
  gitEnv,
  normalizeIntentText,
  testUuid,
} from "./test-utils";

describe("test utils", () => {
  describe("dedentString", () => {
    test("removes indentation in typical usage", () => {
      const output = dedentString(`
        type Query {
          me: User
        }
      `);
      expect(output).toBe(["type Query {", "  me: User", "}"].join("\n"));
    });

    test("removes indentation using tabs and trims edge whitespace", () => {
      const output = dedentString(`

        		type Query {
        		  me: User
        		}
      	\t 
      `);
      expect(output).toBe(["type Query {", "  me: User", "}"].join("\n"));
    });
  });

  describe("dedent", () => {
    test("supports string input with gutter", () => {
      const output = dedent(
        `
          one
          two
        `,
        2,
      );
      expect(output).toBe(["  one", "  two"].join("\n"));
    });

    test("supports template-tag interpolation", () => {
      const name = "acolyte";
      const output = dedent`
        {
          "name": "${name}"
        }
      `;
      expect(output).toBe(["{", '  "name": "acolyte"', "}"].join("\n"));
    });
  });

  describe("expectToThrowJSON", () => {
    test("normalizes thrown objects with toJSON", () => {
      const err = {
        code: "budget-exhausted",
        message: "blocked",
        toJSON() {
          return { code: this.code, message: this.message };
        },
      };
      expectToThrowJSON(() => {
        throw err;
      }).toDeepEqual({
        code: "budget-exhausted",
        message: "blocked",
      });
    });

    test("throws when callback does not throw", () => {
      expect(() => expectToThrowJSON(() => {})).toThrow("Expected function to throw");
    });
  });

  describe("intent helpers", () => {
    test("normalizeIntentText lowers case and collapses whitespace", () => {
      expect(normalizeIntentText("  A   B\nC\tD  ")).toBe("a b c d");
    });

    test("expectIntent matches fragment groups regardless of spacing/case", () => {
      expect(() =>
        expectIntent("Use FILE-READ before file-edit.\nThen stop.", [
          ["file-read", "file-edit"],
          ["then", "stop"],
        ]),
      ).not.toThrow();
    });
  });

  describe("gitEnv", () => {
    test("drops inherited git state and keeps the rest", () => {
      process.env.GIT_DIR = "/decoy/.git";
      process.env.GIT_WORK_TREE = "/decoy";
      try {
        const env = gitEnv();
        expect(env.GIT_DIR).toBeUndefined();
        expect(env.GIT_WORK_TREE).toBeUndefined();
        expect(env.PATH).toBe(process.env.PATH ?? "");
      } finally {
        delete process.env.GIT_DIR;
        delete process.env.GIT_WORK_TREE;
      }
    });

    test("applies git overrides on top of the scrubbed env", () => {
      process.env.GIT_DIR = "/decoy/.git";
      try {
        const env = gitEnv({ GIT_AUTHOR_NAME: "T" });
        expect(env.GIT_AUTHOR_NAME).toBe("T");
        expect(env.GIT_DIR).toBeUndefined();
      } finally {
        delete process.env.GIT_DIR;
      }
    });
  });

  describe("testUuid", () => {
    test("returns distinct non-empty ids", () => {
      const first = testUuid();
      const second = testUuid();
      expect(first.length).toBeGreaterThan(0);
      expect(second.length).toBeGreaterThan(0);
      expect(first).not.toBe(second);
    });
  });
});
