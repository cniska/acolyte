import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addMemory } from "./memory";
import {
  createSoulPrompt,
  getMemoryContextEntries,
  loadAgentsPrompt,
  loadMemoryContextPrompt,
  loadSoulPrompt,
  loadSystemPrompt,
} from "./soul";
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

  test("loadMemoryContextPrompt reads top memory notes", async () => {
    const dir = createDir("acolyte-system-");
    const home = createDir("acolyte-home-");
    await addMemory("Prefer concise bullet lists", { cwd: dir, homeDir: home, scope: "user" });
    await addMemory("Use project-local scripts for verify", { cwd: dir, homeDir: home, scope: "project" });
    const prompt = await loadMemoryContextPrompt({ cwd: dir, homeDir: home });
    expect(prompt.startsWith("User memory context:")).toBe(true);
    expect(prompt).toContain("- Prefer concise bullet lists");
    expect(prompt).toContain("- Use project-local scripts for verify");
  });

  test("createSoulPrompt appends memory context", async () => {
    const dir = createDir("acolyte-system-");
    const home = createDir("acolyte-home-");
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "soul.md"), "Soul prompt body", "utf8");
    await addMemory("Keep answers terse unless asked for details", { cwd: dir, homeDir: home, scope: "user" });
    const prompt = await createSoulPrompt({ cwd: dir, homeDir: home });
    expect(prompt).toContain("Soul prompt body");
    expect(prompt).toContain("User memory context:");
    expect(prompt).toContain("- Keep answers terse unless asked for details");
  });

  test("getMemoryContextEntries sorts globally across scopes by createdAt desc", async () => {
    const dir = createDir("acolyte-system-");
    const home = createDir("acolyte-home-");
    await addMemory("older user memory", { cwd: dir, homeDir: home, scope: "user" });
    await Bun.sleep(5);
    await addMemory("newer project memory", { cwd: dir, homeDir: home, scope: "project" });
    const entries = await getMemoryContextEntries({ cwd: dir, homeDir: home });
    expect(entries[0]?.content).toBe("newer project memory");
    expect(entries[1]?.content).toBe("older user memory");
  });

  test("getMemoryContextEntries supports scope filtering", async () => {
    const dir = createDir("acolyte-system-");
    const home = createDir("acolyte-home-");
    await addMemory("user memory", { cwd: dir, homeDir: home, scope: "user" });
    await addMemory("project memory", { cwd: dir, homeDir: home, scope: "project" });
    const userEntries = await getMemoryContextEntries({ cwd: dir, homeDir: home, scope: "user" });
    const projectEntries = await getMemoryContextEntries({ cwd: dir, homeDir: home, scope: "project" });
    expect(userEntries.map((entry) => entry.content)).toEqual(["user memory"]);
    expect(projectEntries.map((entry) => entry.content)).toEqual(["project memory"]);
  });
});
