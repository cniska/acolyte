import { describe, expect, test } from "bun:test";
import { parseEditArgs } from "./cli-tool";

describe("cli-tool", () => {
  test("parseEditArgs parses path, find, and replace", () => {
    const result = parseEditArgs(["src/cli.ts", "old text", "new text"]);
    expect(result.path).toBe("src/cli.ts");
    expect(result.edits).toEqual([{ find: "old text", replace: "new text" }]);
    expect(result.dryRun).toBe(false);
  });

  test("parseEditArgs joins multi-word replace", () => {
    const result = parseEditArgs(["src/cli.ts", "old", "new", "text", "here"]);
    expect(result.edits[0].replace).toBe("new text here");
  });

  test("parseEditArgs supports --dry-run flag", () => {
    const result = parseEditArgs(["--dry-run", "src/cli.ts", "old", "new"]);
    expect(result.dryRun).toBe(true);
    expect(result.path).toBe("src/cli.ts");
  });

  test("parseEditArgs throws on too few arguments", () => {
    expect(() => parseEditArgs(["src/cli.ts"])).toThrow();
    expect(() => parseEditArgs(["src/cli.ts", "find"])).toThrow();
  });

  test("parseEditArgs throws on empty find string", () => {
    expect(() => parseEditArgs(["src/cli.ts", "", "replace"])).toThrow();
  });
});
