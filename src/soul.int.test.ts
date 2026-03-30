import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createId } from "./short-id";
import { createSoulPrompt, formatMemoryResumeBlock, loadAgentsPrompt, loadSoulPrompt, loadSystemPrompt } from "./soul";
import { expectIntent, tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("soul prompt loading", () => {
  test("loadSoulPrompt returns empty when docs/soul.md is missing", () => {
    const dir = createDir("acolyte-soul-");
    const prompt = loadSoulPrompt(dir);
    expect(prompt).toBe("");
  });

  test("loadAgentsPrompt returns empty when AGENTS.md is missing", () => {
    const dir = createDir("acolyte-agents-");
    expect(loadAgentsPrompt(dir)).toBe("");
  });

  test("loadSystemPrompt combines soul and AGENTS.md", () => {
    const dir = createDir("acolyte-system-");
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "soul.md"), "Soul prompt body", "utf8");
    writeFileSync(join(dir, "AGENTS.md"), "Agent instruction body", "utf8");
    const prompt = loadSystemPrompt(dir);
    expectIntent(prompt, [["soul prompt body"], ["repository instructions (agents.md):"], ["agent instruction body"]]);
  });

  test("createSoulPrompt includes memory context", async () => {
    const dir = createDir("acolyte-system-");
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "soul.md"), "Soul prompt body", "utf8");
    const prompt = await createSoulPrompt({ cwd: dir });
    expectIntent(prompt.prompt, [["soul prompt body"]]);
  });

  test("createSoulPrompt emits load_skipped debug event when request disables memory", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    await createSoulPrompt({
      useMemory: false,
      onDebug: (event, fields) => {
        events.push({ event, fields });
      },
    });
    expect(events[0]?.event).toBe("lifecycle.memory.load_skipped");
    expect(events[0]?.fields?.reason).toBe("request_disabled");
    expect(typeof events[0]?.fields?.budgetTokens).toBe("number");
    expect(typeof events[0]?.fields?.sourceStrategy).toBe("string");
  });

  test("createSoulPrompt emits load_empty debug event when no memory is available", async () => {
    const dir = createDir("acolyte-empty-memory-");
    const events: string[] = [];
    await createSoulPrompt({
      sessionId: `sess_${createId()}`,
      resourceId: `user_${createId()}`,
      workspace: dir,
      onDebug: (event) => {
        events.push(event);
      },
    });
    expect(events).toContain("lifecycle.memory.load_empty");
  });

  test("formatMemoryResumeBlock returns empty when continuation is missing", () => {
    expect(formatMemoryResumeBlock({})).toBe("");
  });

  test("formatMemoryResumeBlock formats continuation state", () => {
    const resume = formatMemoryResumeBlock({
      currentTask: "Implement memory engine",
      nextStep: "Add resume block",
    });
    expect(resume).toBe(
      [
        "Resume context:",
        "- Continue current task: Implement memory engine",
        "- Start with next step: Add resume block",
      ].join("\n"),
    );
  });
});
