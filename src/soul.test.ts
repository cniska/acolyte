import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { loadAgentsPrompt, loadSoulPrompt, loadSystemPrompt } from "./soul";

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
});

