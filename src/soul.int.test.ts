import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSoulPrompt, loadAgentsPrompt, loadSoulPrompt, loadSystemPrompt } from "./soul";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("soul prompt loading", () => {
  test("loadSoulPrompt returns bundled soul", () => {
    const result = loadSoulPrompt();
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Acolyte");
  });

  test("loadAgentsPrompt returns empty when no AGENTS.md", () => {
    const dir = createDir("acolyte-no-agents-");
    expect(loadAgentsPrompt(dir)).toBe("");
  });

  test("loadSystemPrompt combines soul and agents", () => {
    const dir = createDir("acolyte-combined-");
    writeFileSync(join(dir, "AGENTS.md"), "Rules.", "utf8");
    const prompt = loadSystemPrompt(dir);
    expect(prompt).toContain("Acolyte");
    expect(prompt).toContain("Rules.");
  });

  test("loadSystemPrompt can omit agents prompt and include a memory hint", () => {
    const dir = createDir("acolyte-omit-agents-");
    writeFileSync(join(dir, "AGENTS.md"), "Rules.", "utf8");
    const prompt = loadSystemPrompt(dir, { includeAgents: false, agentsHint: "memory" });
    expect(prompt).toContain("Acolyte");
    expect(prompt).not.toContain("Rules.");
    expect(prompt).toContain("memory-search");
  });

  test("createSoulPrompt returns prompt string", async () => {
    const result = await createSoulPrompt();
    expect(result).toContain("Acolyte");
  });
});
