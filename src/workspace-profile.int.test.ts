import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceCommand } from "./workspace-contract";
import { runCommand, runCommandWithFiles } from "./workspace-profile";

const BIOME: WorkspaceCommand = { bin: "bunx", args: ["biome", "check", "$FILES"] };

describe("runCommandWithFiles", () => {
  test("returns no errors for empty file list", async () => {
    const result = await runCommandWithFiles("/tmp", BIOME, []);
    expect(result.hasErrors).toBe(false);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("returns no errors for a clean file", async () => {
    const result = await runCommandWithFiles(import.meta.dir, BIOME, ["workspace-profile.ts"]);
    expect(result.hasErrors).toBe(false);
  });

  test("treats errors on missing files as lint errors", async () => {
    const result = await runCommandWithFiles(import.meta.dir, BIOME, ["nonexistent-file.ts"]);
    expect(result.hasErrors).toBe(true);
  });

  test("captures stdout and stderr separately", async () => {
    const result = await runCommand(import.meta.dir, { bin: "bash", args: ["-c", "echo out; echo err >&2; exit 1"] });
    expect(result.hasErrors).toBe(true);
    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
  });
});

describe("runCommand spawn failures", () => {
  test("treats a missing binary as nothing to report", async () => {
    const result = await runCommand(import.meta.dir, { bin: "definitely-not-a-real-binary-xyz", args: [] });
    expect(result.hasErrors).toBe(false);
    expect(result.stderr).toBe("");
  });

  test("surfaces a spawn refusal that is not a missing binary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-spawn-"));
    const script = join(dir, "noexec.sh");
    writeFileSync(script, "#!/bin/sh\necho hi\n", { mode: 0o644 });
    const result = await runCommand(dir, { bin: script, args: [] });
    rmSync(dir, { recursive: true, force: true });

    expect(result.hasErrors).toBe(true);
    expect(result.stderr).toContain("EACCES");
  });
});
