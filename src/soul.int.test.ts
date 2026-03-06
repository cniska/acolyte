import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMemoryResumeBlock, createSoulPrompt, loadAgentsPrompt, loadSoulPrompt, loadSystemPrompt } from "./soul";
import { tempDir } from "./test-utils";

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
    expect(prompt).toContain("Soul prompt body");
    expect(prompt).toContain("Repository Instructions (AGENTS.md):");
    expect(prompt).toContain("Agent instruction body");
  });

  test("createSoulPrompt includes memory context", async () => {
    const dir = createDir("acolyte-system-");
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "soul.md"), "Soul prompt body", "utf8");
    const prompt = await createSoulPrompt({ cwd: dir });
    expect(prompt).toContain("Soul prompt body");
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
    const events: string[] = [];
    await createSoulPrompt({
      sessionId: "sess_test0001",
      onDebug: (event) => {
        events.push(event);
      },
    });
    expect(events).toContain("lifecycle.memory.load_empty");
  });

  test("buildMemoryResumeBlock returns empty when continuation is missing", () => {
    expect(buildMemoryResumeBlock({})).toBe("");
  });

  test("buildMemoryResumeBlock formats continuation state", () => {
    const resume = buildMemoryResumeBlock({
      currentTask: "Implement memory engine",
      nextStep: "Add resume block",
    });
    expect(resume).toBe(
      ["Resume context:", "- Continue current task: Implement memory engine", "- Start with next step: Add resume block"].join(
        "\n",
      ),
    );
  });
});
