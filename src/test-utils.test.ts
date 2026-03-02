import { describe, expect, test } from "bun:test";
import { dedent, dedentString, expectToThrowJSON } from "./test-utils";

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
        code: "guard-blocked",
        message: "blocked",
        toJSON() {
          return { code: this.code, message: this.message };
        },
      };
      expectToThrowJSON(() => {
        throw err;
      }).toDeepEqual({
        code: "guard-blocked",
        message: "blocked",
      });
    });

    test("throws when callback does not throw", () => {
      expect(() => expectToThrowJSON(() => {})).toThrow("Expected function to throw");
    });
  });
});
