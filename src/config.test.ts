import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, setConfigValue, unsetConfigValue } from "./config";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("config store", () => {
  test("reads non-secret settings from config.toml", async () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      ['model = "anthropic/claude-sonnet-4"', 'apiUrl = "http://localhost:6767"'].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home });
    expect(loaded).toEqual({
      model: "anthropic/claude-sonnet-4",
      apiUrl: "http://localhost:6767",
    });
  });

  test("ignores apiKey in file config (secrets are env-only)", async () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      ['model = "openai/gpt-5-mini"', 'apiUrl = "http://localhost:6767"', 'apiKey = "secret-should-be-ignored"'].join(
        "\n",
      ),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      apiUrl: "http://localhost:6767",
    });
  });

  test("prefers config.toml when both TOML and JSON exist", async () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "gemini/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = await readConfig({ homeDir: home });
    expect(loaded.model).toBe("gemini/gemini-2.5-pro");
  });

  test("falls back to JSON when TOML is absent", async () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ model: "openai/gpt-5-mini", apiUrl: "http://localhost:6767" }, null, 2),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      apiUrl: "http://localhost:6767",
    });
  });

  test("setConfigValue updates TOML when config.toml exists", async () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");

    await setConfigValue("apiUrl", "http://localhost:6767", { homeDir: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain('apiUrl = "http://localhost:6767"');
  });

  test("unsetConfigValue removes field from TOML when config.toml exists", async () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      'model = "openai/gpt-5-mini"\napiUrl = "http://localhost:6767"\n',
      "utf8",
    );

    await unsetConfigValue("apiUrl", { homeDir: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).not.toContain("apiUrl =");
  });
});
