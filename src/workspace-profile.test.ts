import { describe, expect, test } from "bun:test";
import { createWorkspaceInstructions, resolveCommandFiles } from "./workspace-profile";

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

describe("createWorkspaceInstructions", () => {
  test("names the ecosystem, package manager, and test runner", () => {
    const lines = createWorkspaceInstructions({
      ecosystem: "typescript",
      packageManager: "bun",
      testCommand: { bin: "bun", args: ["test", "$FILES"] },
    });
    expect(lines).toEqual([
      "This is a typescript project.",
      "It uses bun. Use it for install and run commands.",
      "Its tests run under `bun test`, which the test tool invokes.",
    ]);
  });

  test("never hands the model a command still carrying the file placeholder", () => {
    const lines = createWorkspaceInstructions({
      testCommand: { bin: "bunx", args: ["vitest", "$FILES"] },
    });
    expect(lines.join("\n")).not.toContain("$FILES");
  });

  test("says the harness owns formatting and linting rather than naming those commands", () => {
    const lines = createWorkspaceInstructions({
      formatCommand: { bin: "biome", args: ["check", "--write", "$FILES"] },
      lintCommand: { bin: "biome", args: ["check", "$FILES"] },
    });
    const text = lines.join("\n");
    expect(text).toContain("The harness formats and lints every file I write");
    expect(text).not.toContain("biome");
  });

  test("mentions dependency install only when the workspace has an install command", () => {
    expect(createWorkspaceInstructions({}).join("\n")).not.toContain("installs dependencies");
    expect(createWorkspaceInstructions({ installCommand: { bin: "bun", args: ["install"] } }).join("\n")).toContain(
      "installs dependencies",
    );
  });
});
