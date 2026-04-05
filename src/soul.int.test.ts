import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSoulPrompt, loadAgentsPrompt, loadSoulPrompt, loadSystemPrompt } from "./soul";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("soul prompt loading", () => {
  test("loadSoulPrompt falls back to package root when no project soul file", () => {
    const dir = createDir("acolyte-empty-soul-");
    const result = loadSoulPrompt(dir);
    // Falls back to package root's docs/soul.md
    expect(result.length).toBeGreaterThan(0);
  });

  test("loadSoulPrompt prefers project soul over package root", () => {
    const dir = createDir("acolyte-override-soul-");
    const docsDir = join(dir, "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "soul.md"), "Custom soul.", "utf8");
    expect(loadSoulPrompt(dir)).toBe("Custom soul.");
  });

  test("loadSoulPrompt reads docs/soul.md", () => {
    const dir = createDir("acolyte-soul-");
    const docsDir = join(dir, "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "soul.md"), "I am Acolyte.", "utf8");
    expect(loadSoulPrompt(dir)).toBe("I am Acolyte.");
  });

  test("loadAgentsPrompt returns empty when no AGENTS.md", () => {
    const dir = createDir("acolyte-no-agents-");
    expect(loadAgentsPrompt(dir)).toBe("");
  });

  test("loadSystemPrompt combines soul and agents", () => {
    const dir = createDir("acolyte-combined-");
    const docsDir = join(dir, "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "soul.md"), "Soul.", "utf8");
    writeFileSync(join(dir, "AGENTS.md"), "Rules.", "utf8");
    const prompt = loadSystemPrompt(dir);
    expect(prompt).toContain("Soul.");
    expect(prompt).toContain("Rules.");
  });

  test("createSoulPrompt returns prompt string", async () => {
    const dir = createDir("acolyte-soul-prompt-");
    const docsDir = join(dir, "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "soul.md"), "I am Acolyte.", "utf8");
    const result = await createSoulPrompt({ cwd: dir });
    expect(result).toContain("I am Acolyte.");
  });
});
