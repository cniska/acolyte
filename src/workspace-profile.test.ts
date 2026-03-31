import { describe, expect, test } from "bun:test";
import type { WorkspaceCommand } from "./workspace-profile";
import { resolveCommandFiles, runCommand, runCommandWithFiles } from "./workspace-profile";

const BIOME: WorkspaceCommand = { bin: "bunx", args: ["biome", "check", "$FILES"] };

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

describe("runCommandWithFiles", () => {
  test("returns no errors for empty file list", () => {
    const result = runCommandWithFiles("/tmp", BIOME, []);
    expect(result.hasErrors).toBe(false);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("returns no errors for a clean file", () => {
    const result = runCommandWithFiles(import.meta.dir, BIOME, ["workspace-profile.ts"]);
    expect(result.hasErrors).toBe(false);
  });

  test("treats errors on missing files as lint errors", () => {
    const result = runCommandWithFiles(import.meta.dir, BIOME, ["nonexistent-file.ts"]);
    expect(result.hasErrors).toBe(true);
  });

  test("captures stdout and stderr separately", () => {
    const result = runCommand(import.meta.dir, { bin: "bash", args: ["-c", "echo out; echo err >&2; exit 1"] });
    expect(result.hasErrors).toBe(true);
    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
  });
});
