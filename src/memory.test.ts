import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMemory, listMemories } from "./memory";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("markdown memory store", () => {
  test("writes user memory as markdown with frontmatter", async () => {
    const homeDir = makeTempDir("acolyte-memory-home-");
    const cwd = makeTempDir("acolyte-memory-cwd-");
    const entry = await addMemory("Prefer concise answers", { scope: "user", homeDir, cwd });

    const memoryDir = join(homeDir, ".acolyte", "memory", "user");
    const files = readdirSync(memoryDir).filter((name) => name.endsWith(".md"));
    expect(files.length).toBe(1);
    const raw = readFileSync(join(memoryDir, files[0] ?? ""), "utf8");
    expect(raw).toContain("---");
    expect(raw).toContain(`id: ${entry.id}`);
    expect(raw).toContain("scope: user");
    expect(raw).toContain("Prefer concise answers");
  });

  test("supports separate project and user memories", async () => {
    const homeDir = makeTempDir("acolyte-memory-home-");
    const cwd = makeTempDir("acolyte-memory-cwd-");
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
});
