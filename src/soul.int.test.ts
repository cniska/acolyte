import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSoulPrompt, loadAgentsPrompt, loadSoulPrompt, loadSystemPrompt } from "./soul";
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
});
