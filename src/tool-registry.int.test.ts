import { expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

// Entering the module graph at tool-registry is the order that crashes when a cycle reaches back
// into it during its own evaluation. The in-process suite cannot pin this — whichever test file
// loads first fixes the order for the whole run — so assert it in a fresh process.
function importFirst(specifier: string): { exitCode: number; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", `await import(${JSON.stringify(specifier)});`],
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

test.each([
  "./src/tool-registry.ts",
  "./src/agent-instructions.ts",
  "./src/memory-ops.ts",
])("%s initializes when imported first", (specifier) => {
  const { exitCode, stderr } = importFirst(specifier);
  expect(stderr).not.toContain("before initialization");
  expect(exitCode).toBe(0);
});
