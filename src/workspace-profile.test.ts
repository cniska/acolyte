import { describe, expect, test } from "bun:test";
import type { WorkspaceCommand } from "./workspace-profile";
import { runCommandWithFiles } from "./workspace-profile";

const BIOME: WorkspaceCommand = { bin: "bunx", args: ["biome", "check"] };

describe("runCommandWithFiles", () => {
  test("returns no errors for empty file list", () => {
    const result = runCommandWithFiles("/tmp", BIOME, []);
    expect(result.hasErrors).toBe(false);
    expect(result.output).toBe("");
  });

  test("returns no errors for a clean file", () => {
    const result = runCommandWithFiles(import.meta.dir, BIOME, ["workspace-profile.ts"]);
    expect(result.hasErrors).toBe(false);
  });

  test("treats errors on missing files as lint errors", () => {
    const result = runCommandWithFiles(import.meta.dir, BIOME, ["nonexistent-file.ts"]);
    expect(result.hasErrors).toBe(true);
  });
});
