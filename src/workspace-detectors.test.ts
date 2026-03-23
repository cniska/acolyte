import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import { clearWorkspaceProfileCache, resolveWorkspaceProfile } from "./workspace-profile";

const { createDir, cleanupDirs } = tempDir();
afterEach(() => {
  cleanupDirs();
  clearWorkspaceProfileCache();
});

function makeWorkspace(files: Record<string, string>): string {
  const dir = createDir("acolyte-ws-");
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }
  return dir;
}

describe("typescript detector", () => {
  test("detects biome lint from biome.json", () => {
    const ws = makeWorkspace({ "biome.json": "{}", "package.json": '{"scripts":{}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("typescript");
    expect(profile.lintCommand?.bin).toBe("bunx");
    expect(profile.lintCommand?.args).toContain("biome");
  });

  test("detects eslint from eslint.config.js", () => {
    const ws = makeWorkspace({ "eslint.config.js": "", "package.json": '{"scripts":{}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("typescript");
    expect(profile.lintCommand?.bin).toBe("npx");
    expect(profile.lintCommand?.args).toContain("eslint");
  });

  test("detects verify command from package.json scripts", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"verify":"bun run lint && bun test"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("typescript");
    expect(profile.verifyCommand).toEqual({ bin: "bun", args: ["run", "verify"] });
  });

  test("falls back to test script when verify is absent", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"test":"jest"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.verifyCommand).toEqual({ bin: "bun", args: ["run", "test"] });
  });

  test("falls back to check script when verify and test are absent", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"check":"tsc --noEmit"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.verifyCommand).toEqual({ bin: "bun", args: ["run", "check"] });
  });

  test("detects lineWidth from biome.json", () => {
    const ws = makeWorkspace({
      "biome.json": '{"formatter":{"lineWidth":120}}',
      "package.json": '{"scripts":{}}',
    });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lineWidth).toBe(120);
  });

  test("detects lineWidth from .editorconfig when no biome", () => {
    const ws = makeWorkspace({
      "package.json": '{"scripts":{"test":"jest"}}',
      ".editorconfig": "root = true\n[*]\nmax_line_length = 100\n",
    });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lineWidth).toBe(100);
  });

  test("no verify command when package.json has no relevant scripts", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"start":"node index.js"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.verifyCommand).toBeUndefined();
  });

  test("uses bun when bun.lock exists", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"verify":"echo ok"}}', "bun.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.verifyCommand?.bin).toBe("bun");
  });

  test("uses npm when package-lock.json exists", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"verify":"echo ok"}}', "package-lock.json": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.verifyCommand?.bin).toBe("npm");
  });
});

describe("python detector", () => {
  test("detects ruff from ruff.toml", () => {
    const ws = makeWorkspace({ "ruff.toml": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("python");
    expect(profile.lintCommand).toEqual({ bin: "ruff", args: ["check"] });
  });

  test("detects ruff from pyproject.toml with tool.ruff section", () => {
    const ws = makeWorkspace({ "pyproject.toml": "[tool.ruff]\nline-length = 120" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("python");
    expect(profile.lintCommand).toEqual({ bin: "ruff", args: ["check"] });
  });

  test("detects pytest as verify command", () => {
    const ws = makeWorkspace({ "pyproject.toml": "[tool.ruff]\n" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.verifyCommand).toEqual({ bin: "pytest", args: [] });
  });
});

describe("go detector", () => {
  test("detects go vet from go.mod", () => {
    const ws = makeWorkspace({ "go.mod": "module example.com/foo" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("go");
    expect(profile.lintCommand).toEqual({ bin: "go", args: ["vet", "./..."] });
    expect(profile.verifyCommand).toEqual({ bin: "go", args: ["test", "./..."] });
  });
});

describe("rust detector", () => {
  test("detects cargo clippy from Cargo.toml", () => {
    const ws = makeWorkspace({ "Cargo.toml": '[package]\nname = "foo"' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("rust");
    expect(profile.lintCommand).toEqual({ bin: "cargo", args: ["clippy", "--all-targets", "--", "-D", "warnings"] });
    expect(profile.verifyCommand).toEqual({ bin: "cargo", args: ["test"] });
  });
});

describe("no match", () => {
  test("returns empty profile for unknown workspace", () => {
    const ws = makeWorkspace({ "README.md": "hello" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBeUndefined();
    expect(profile.lintCommand).toBeUndefined();
    expect(profile.verifyCommand).toBeUndefined();
  });
});

describe("cache", () => {
  test("returns cached profile on second call", () => {
    const ws = makeWorkspace({ "go.mod": "module example.com/foo" });
    const first = resolveWorkspaceProfile(ws);
    const second = resolveWorkspaceProfile(ws);
    expect(first).toBe(second);
  });

  test("clearWorkspaceProfileCache resets cache", () => {
    const ws = makeWorkspace({ "go.mod": "module example.com/foo" });
    const first = resolveWorkspaceProfile(ws);
    clearWorkspaceProfileCache();
    const second = resolveWorkspaceProfile(ws);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
