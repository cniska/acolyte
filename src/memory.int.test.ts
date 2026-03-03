import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addMemory, listMemories, removeMemoryByPrefix } from "./memory";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("markdown memory store", () => {
  test("writes user memory as markdown with frontmatter", async () => {
    const homeDir = createDir("acolyte-memory-home-");
    const cwd = createDir("acolyte-memory-cwd-");
    const entry = await addMemory("Prefer concise answers", { scope: "user", homeDir, cwd });

    const memoryDir = join(homeDir, ".acolyte", "memory", "user");
    const files = readdirSync(memoryDir).filter((name) => name.endsWith(".md"));
    expect(files.length).toBe(1);
    expect(files[0]).toBe(`${entry.id}.md`);
    const raw = readFileSync(join(memoryDir, files[0] ?? ""), "utf8");
    expect(raw).toContain("---");
    expect(raw).toContain(`id: ${entry.id}`);
    expect(raw).toContain("scope: user");
    expect(raw).toContain("Prefer concise answers");
  });

  test("supports separate project and user memories", async () => {
    const homeDir = createDir("acolyte-memory-home-");
    const cwd = createDir("acolyte-memory-cwd-");
    await addMemory("Global preference", { scope: "user", homeDir, cwd });
    await addMemory("Project convention", { scope: "project", homeDir, cwd });

    const projectOnly = await listMemories({ scope: "project", homeDir, cwd });
    const userOnly = await listMemories({ scope: "user", homeDir, cwd });
    const all = await listMemories({ scope: "all", homeDir, cwd });

    expect(projectOnly).toHaveLength(1);
    expect(projectOnly[0]?.scope).toBe("project");
    expect(userOnly).toHaveLength(1);
    expect(userOnly[0]?.scope).toBe("user");
    expect(all).toHaveLength(2);
    expect(all.some((entry) => entry.scope === "project")).toBe(true);
    expect(all.some((entry) => entry.scope === "user")).toBe(true);
  });

  test("removeMemoryByPrefix removes a matching memory", async () => {
    const homeDir = createDir("acolyte-memory-home-");
    const cwd = createDir("acolyte-memory-cwd-");
    const entry = await addMemory("Disposable note", { scope: "user", homeDir, cwd });
    const result = await removeMemoryByPrefix(entry.id.slice(0, 12), { homeDir, cwd });
    expect(result.kind).toBe("removed");
    const all = await listMemories({ homeDir, cwd });
    expect(all.some((item) => item.id === entry.id)).toBe(false);
  });

  test("removeMemoryByPrefix returns not_found for unknown prefix", async () => {
    const homeDir = createDir("acolyte-memory-home-");
    const cwd = createDir("acolyte-memory-cwd-");
    const result = await removeMemoryByPrefix("mem_missing", { homeDir, cwd });
    expect(result).toEqual({ kind: "not_found", prefix: "mem_missing" });
  });
});
