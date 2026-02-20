import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMemory } from "./memory";
import { createSoulPrompt, loadAgentsPrompt, loadMemoryContextPrompt, loadSoulPrompt, loadSystemPrompt } from "./soul";

describe("soul prompt loading", () => {
  test("loadSoulPrompt uses fallback when docs/soul.md is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-soul-"));
    try {
      const prompt = loadSoulPrompt(dir);
      expect(prompt).toContain("You are Acolyte");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadAgentsPrompt returns empty when AGENTS.md is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-agents-"));
    try {
      expect(loadAgentsPrompt(dir)).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadSystemPrompt combines soul and AGENTS.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-system-"));
    try {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs", "soul.md"), "Soul prompt body", "utf8");
      writeFileSync(join(dir, "AGENTS.md"), "Agent instruction body", "utf8");
      const prompt = loadSystemPrompt(dir);
      expect(prompt).toContain("Soul prompt body");
      expect(prompt).toContain("Repository Instructions (AGENTS.md):");
      expect(prompt).toContain("Agent instruction body");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadMemoryContextPrompt reads top memory notes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-system-"));
    const home = mkdtempSync(join(tmpdir(), "acolyte-home-"));
    try {
      await addMemory("Prefer concise bullet lists", { cwd: dir, homeDir: home, scope: "user" });
      await addMemory("Use project-local scripts for verify", { cwd: dir, homeDir: home, scope: "project" });
      const prompt = await loadMemoryContextPrompt({ cwd: dir, homeDir: home });
      expect(prompt.startsWith("User memory context:")).toBe(true);
      expect(prompt).toContain("- Prefer concise bullet lists");
      expect(prompt).toContain("- Use project-local scripts for verify");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("createSoulPrompt appends memory context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-system-"));
    const home = mkdtempSync(join(tmpdir(), "acolyte-home-"));
    try {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs", "soul.md"), "Soul prompt body", "utf8");
      await addMemory("Keep answers terse unless asked for details", { cwd: dir, homeDir: home, scope: "user" });
      const prompt = await createSoulPrompt({ cwd: dir, homeDir: home });
      expect(prompt).toContain("Soul prompt body");
      expect(prompt).toContain("User memory context:");
      expect(prompt).toContain("- Keep answers terse unless asked for details");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
