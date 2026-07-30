import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";

// The resolved version is memoized per process and the suite shares one, so any earlier git call
// would satisfy this. A child process with an empty PATH is the only way to reach the cold path.
test("names git as the missing prerequisite when it is not on PATH", async () => {
  const script = `
    const { requireGitVersion } = await import(${JSON.stringify(join(import.meta.dir, "git-ops.ts"))});
    const failure = await requireGitVersion().catch((error) => error);
    console.log(JSON.stringify({ code: failure.code, message: failure.message }));
  `;
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", script],
    env: { ...process.env, PATH: mkdtempSync(join(tmpdir(), "acolyte-nogit-")) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  const failure = JSON.parse(stdout.trim());

  expect(failure.code).toBe(TOOL_ERROR_CODES.gitUnavailable);
  expect(failure.message).toContain("2.14");
});
