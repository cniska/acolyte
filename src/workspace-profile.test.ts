import { describe, expect, test } from "bun:test";
import { resolveCommandFiles } from "./workspace-profile";

describe("resolveCommandFiles", () => {
  test("expands $FILES placeholder with file paths", () => {
    const cmd = resolveCommandFiles({ bin: "ruff", args: ["check", "$FILES"] }, ["a.py", "b.py"]);
    expect(cmd).toEqual({ bin: "ruff", args: ["check", "a.py", "b.py"] });
  });

  test("preserves args when no $FILES placeholder", () => {
    const cmd = resolveCommandFiles({ bin: "cargo", args: ["fmt"] }, ["a.rs"]);
    expect(cmd).toEqual({ bin: "cargo", args: ["fmt"] });
  });

  test("handles empty file list", () => {
    const cmd = resolveCommandFiles({ bin: "eslint", args: ["$FILES"] }, []);
    expect(cmd).toEqual({ bin: "eslint", args: [] });
  });
});
