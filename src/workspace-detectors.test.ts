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
  test("detects biome lint and format from biome.json", () => {
    const ws = makeWorkspace({ "biome.json": "{}", "package.json": '{"scripts":{}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("typescript");
    expect(profile.lintCommand?.bin).toBe("npx");
    expect(profile.lintCommand?.args).toContain("biome");
    expect(profile.formatCommand?.args).toContain("--write");
  });

  test("detects eslint from eslint.config.js", () => {
    const ws = makeWorkspace({ "eslint.config.js": "", "package.json": '{"scripts":{}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("typescript");
    expect(profile.lintCommand?.bin).toBe("npx");
    expect(profile.lintCommand?.args).toContain("eslint");
  });

  test("detects jest test command from package.json scripts", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"test":"jest"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("typescript");
    expect(profile.testCommand).toEqual({ bin: "npx", args: ["jest", "$FILES"] });
  });

  test("detects vitest test command from package.json scripts", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"test":"vitest"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.testCommand).toEqual({ bin: "npx", args: ["vitest", "$FILES"] });
  });

  test("no test command when package.json has no test scripts", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"start":"node index.js"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.testCommand).toBeUndefined();
  });

  test("detects bun test when bun.lock exists", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{}}', "bun.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.testCommand).toEqual({ bin: "bun", args: ["test", "$FILES"] });
  });

  test("exposes detected package manager from lock file", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{"test":"jest"}}', "bun.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.packageManager).toBe("bun");
  });

  test("detects package manager from packageManager field", () => {
    const ws = makeWorkspace({ "package.json": '{"packageManager":"pnpm@9.1.0","scripts":{"test":"vitest"}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.packageManager).toBe("pnpm");
  });

  test("detects oxlint from oxlintrc.json", () => {
    const ws = makeWorkspace({ "oxlintrc.json": "{}", "package.json": '{"scripts":{}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lintCommand?.args).toContain("oxlint");
  });

  test("uses yarn dlx for biome in yarn projects", () => {
    const ws = makeWorkspace({ "biome.json": "{}", "package.json": '{"scripts":{}}', "yarn.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lintCommand?.bin).toBe("yarn");
    expect(profile.lintCommand?.args).toEqual(["dlx", "biome", "check", "$FILES"]);
  });

  test("detects biome from biome.jsonc with comments", () => {
    const ws = makeWorkspace({
      "biome.jsonc": '{\n  // formatting\n  "formatter": {}\n}',
      "package.json": '{"scripts":{}}',
    });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lintCommand?.args).toContain("biome");
  });

  test("uses npx for biome in npm projects", () => {
    const ws = makeWorkspace({ "biome.json": "{}", "package.json": '{"scripts":{}}', "package-lock.json": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lintCommand?.bin).toBe("npx");
    expect(profile.formatCommand?.bin).toBe("npx");
  });

  test("detects install command from package manager", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{}}', "bun.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "bun", args: ["install"] });
    expect(profile.depsDir).toBe("node_modules");
  });

  test("detects npm install for npm projects", () => {
    const ws = makeWorkspace({ "package.json": '{"scripts":{}}', "package-lock.json": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "npm", args: ["install"] });
  });

  test("detects pnpm install for pnpm projects", () => {
    const ws = makeWorkspace({ "package.json": '{"packageManager":"pnpm@9.1.0","scripts":{}}' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "pnpm", args: ["install"] });
  });
});

describe("python detector", () => {
  test("detects flake8 from .flake8", () => {
    const ws = makeWorkspace({ ".flake8": "[flake8]\nmax-line-length = 120", "pyproject.toml": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lintCommand).toEqual({ bin: "flake8", args: ["$FILES"] });
  });

  test("detects black from pyproject.toml", () => {
    const ws = makeWorkspace({ "pyproject.toml": "[tool.black]\nline-length = 88" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.formatCommand).toEqual({ bin: "black", args: ["$FILES"] });
  });

  test("detects uv as package manager", () => {
    const ws = makeWorkspace({ "pyproject.toml": "[tool.ruff]\n", "uv.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.packageManager).toBe("uv");
  });

  test("defaults to pip when no lock file", () => {
    const ws = makeWorkspace({ "ruff.toml": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.packageManager).toBe("pip");
  });

  test("detects uv sync as install command", () => {
    const ws = makeWorkspace({ "pyproject.toml": "[tool.ruff]\n", "uv.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "uv", args: ["sync"] });
    expect(profile.depsDir).toBe(".venv");
  });

  test("detects poetry install for poetry projects", () => {
    const ws = makeWorkspace({ "pyproject.toml": "", "poetry.lock": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "poetry", args: ["install"] });
  });

  test("defaults to pip install for pip projects", () => {
    const ws = makeWorkspace({ "ruff.toml": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "pip", args: ["install", "-e", "."] });
  });

  test("detects ruff lint and format from ruff.toml", () => {
    const ws = makeWorkspace({ "ruff.toml": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("python");
    expect(profile.lintCommand).toEqual({ bin: "ruff", args: ["check", "$FILES"] });
    expect(profile.formatCommand).toEqual({ bin: "ruff", args: ["format", "$FILES"] });
  });

  test("detects ruff from pyproject.toml with tool.ruff section", () => {
    const ws = makeWorkspace({ "pyproject.toml": "[tool.ruff]\nline-length = 120" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("python");
    expect(profile.lintCommand).toEqual({ bin: "ruff", args: ["check", "$FILES"] });
  });

  test("detects pytest as test command", () => {
    const ws = makeWorkspace({ "pyproject.toml": "[tool.ruff]\n" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.testCommand).toEqual({ bin: "pytest", args: ["$FILES"] });
  });
});

describe("go detector", () => {
  test("detects golangci-lint when config exists", () => {
    const ws = makeWorkspace({ "go.mod": "module example.com/foo", ".golangci.yml": "" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.lintCommand).toEqual({ bin: "golangci-lint", args: ["run", "$FILES"] });
  });

  test("falls back to go vet without golangci-lint config", () => {
    const ws = makeWorkspace({ "go.mod": "module example.com/foo" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("go");
    expect(profile.lintCommand).toEqual({ bin: "go", args: ["vet", "$FILES"] });
    expect(profile.formatCommand).toEqual({ bin: "gofmt", args: ["-w", "$FILES"] });
    expect(profile.testCommand).toEqual({ bin: "go", args: ["test", "$FILES"] });
  });

  test("detects go mod download as install command", () => {
    const ws = makeWorkspace({ "go.mod": "module example.com/foo" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "go", args: ["mod", "download"] });
  });
});

describe("rust detector", () => {
  test("detects cargo clippy and fmt from Cargo.toml", () => {
    const ws = makeWorkspace({ "Cargo.toml": '[package]\nname = "foo"' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("rust");
    expect(profile.lintCommand).toEqual({
      bin: "cargo",
      args: ["clippy", "--all-targets", "--", "-D", "warnings", "$FILES"],
    });
    expect(profile.formatCommand).toEqual({ bin: "cargo", args: ["fmt", "--", "$FILES"] });
    expect(profile.testCommand).toEqual({ bin: "cargo", args: ["test", "--", "$FILES"] });
  });

  test("detects cargo fetch as install command", () => {
    const ws = makeWorkspace({ "Cargo.toml": '[package]\nname = "foo"' });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.installCommand).toEqual({ bin: "cargo", args: ["fetch"] });
  });
});

describe("no match", () => {
  test("returns empty profile for unknown workspace", () => {
    const ws = makeWorkspace({ "README.md": "hello" });
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBeUndefined();
    expect(profile.lintCommand).toBeUndefined();
    expect(profile.testCommand).toBeUndefined();
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
