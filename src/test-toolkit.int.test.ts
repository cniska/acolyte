import { afterAll, expect, test } from "bun:test";
import { createTestToolkit } from "./test-toolkit";
import { tempDir } from "./test-utils";
import { createSessionContext } from "./tool-session";

const { createDir, cleanupDirs } = tempDir();
afterAll(cleanupDirs);

function sleeper(first: string, ms: number, second: string): string[] {
  return ["-e", `console.log("${first}"); await new Promise((r) => setTimeout(r, ${ms})); console.log("${second}");`];
}

test("test-run streams its output while the suite is still running", async () => {
  const captured: Array<{ text: string; transient: boolean }> = [];
  const session = createSessionContext();
  session.workspaceProfile = { testCommand: { bin: "bun", args: sleeper("FIRST", 3000, "SECOND") } };
  const toolkit = createTestToolkit({
    workspace: createDir("test-toolkit"),
    session,
    onOutput: (event) => {
      if (event.content.kind !== "shell-output") return;
      captured.push({ text: event.content.text, transient: event.transient === true });
    },
    onTasklist: () => {},
    onSkillActivated: () => {},
    onSkillDeactivated: () => {},
  });

  // The command has no $FILES placeholder, so the file list is never appended.
  // Probe mid-run: buffering until the suite exits leaves `captured` empty here, so this fails.
  const pending = toolkit.runTests.execute({ files: ["src/example.test.ts"] }, "tc_stream");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const midRun = captured.map((entry) => entry.text);
  await pending;

  expect(midRun).toContain("FIRST");
  expect(midRun).not.toContain("SECOND");
  expect(captured.find((entry) => entry.text === "FIRST")?.transient).toBe(true);
});
