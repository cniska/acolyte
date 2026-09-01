import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  readConfig,
  readConfigForScope,
  readConfigSync,
  readResolvedConfigSync,
  setConfigValue,
  unsetConfigValue,
  writeConfig,
} from "./config";
import { configDir } from "./paths";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("config store", () => {
  test("reads non-secret settings from config.toml", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      ['model = "anthropic/claude-sonnet-4"', "port = 7777"].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ env: { HOME: home }, cwd: home });
    expect(loaded).toEqual({
      model: "anthropic/claude-sonnet-4",
      port: 7777,
    });
  });

  test("ignores apiKey in file config (secrets are env-only)", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      ['model = "openai/gpt-5-mini"', "port = 7777", 'apiKey = "secret-should-be-ignored"'].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ env: { HOME: home }, cwd: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      port: 7777,
    });
  });

  test("prefers config.toml when both TOML and JSON exist", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "google/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = await readConfig({ env: { HOME: home }, cwd: home });
    expect(loaded.model).toBe("google/gemini-2.5-pro");
  });

  test("falls back to JSON when TOML is absent", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ model: "openai/gpt-5-mini", port: 7777 }, null, 2),
      "utf8",
    );

    const loaded = await readConfig({ env: { HOME: home }, cwd: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      port: 7777,
    });
  });

  test("readConfigSync prefers TOML over JSON", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "google/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = readConfigSync({ env: { HOME: home }, cwd: home });
    expect(loaded.model).toBe("google/gemini-2.5-pro");
  });

  test("readConfigSync throws on malformed config with scope", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "not valid toml = {", "utf8");

    expect(() => readConfigSync({ env: { HOME: home }, cwd: home })).toThrow(/user config/);
  });

  test("setConfigValue updates TOML when config.toml exists", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");

    await setConfigValue("port", "7777", { env: { HOME: home }, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain("port = 7777");
  });

  test("unsetConfigValue removes field from TOML when config.toml exists", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\nport = 7777\n', "utf8");

    await unsetConfigValue("port", { env: { HOME: home }, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).not.toContain("port =");
  });

  test("writeConfig sanitizes unexpected secret fields before persisting", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");

    await writeConfig(
      {
        model: "openai/gpt-5-mini",
        port: 7777,
        ...({ apiKey: "secret-should-not-persist" } as unknown as Record<string, string>),
      } as unknown as { model: string; port: number; apiKey: string },
      { env: { HOME: home }, cwd: home },
    );
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain("port = 7777");
    expect(rawToml).not.toContain("apiKey");
  });

  test("writeConfig writes TOML by default when only JSON existed", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    await writeConfig(
      {
        model: "openai/gpt-5-mini",
        port: 7777,
      },
      { env: { HOME: home }, cwd: home },
    );

    expect(existsSync(join(dataDir, "config.toml"))).toBe(true);
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain("port = 7777");
  });

  test("reads non-secret runtime knobs from config.toml", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      [
        "port = 7777",
        'locale = "en"',
        'model = "openai/gpt-5-mini"',
        'openaiBaseUrl = "https://openai.example.com/v1"',
        'anthropicBaseUrl = "https://anthropic.example.com"',
        'googleBaseUrl = "https://google.example.com"',

        'logFormat = "json"',
        "replyTimeoutMs = 220000",
      ].join("\n"),
      "utf8",
    );

    const loaded = readConfigSync({ env: { HOME: home }, cwd: home });
    expect(loaded.port).toBe(7777);
    expect(loaded.locale).toBe("en");
    expect(loaded.model).toBe("openai/gpt-5-mini");

    expect(loaded.logFormat).toBe("json");
    expect(loaded.replyTimeoutMs).toBe(220000);
  });

  test("reads feature flags from [features] section in config.toml", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), ["[features]", "undoCheckpoints = true"].join("\n"), "utf8");

    const loaded = readConfigSync({ env: { HOME: home }, cwd: home });
    expect(loaded.features).toEqual({ undoCheckpoints: true });

    const resolved = readResolvedConfigSync({ env: { HOME: home }, cwd: home });
    expect(resolved.features.undoCheckpoints).toBe(true);
  });

  test("readResolvedConfigSync applies defaults and model fallbacks", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n', "utf8");

    const resolved = readResolvedConfigSync({ env: { HOME: home }, cwd: home });
    expect(resolved.port).toBe(6767);
    expect(resolved.locale).toBe("en");
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.distillModel).toBe("anthropic/claude-sonnet-4");
    expect(resolved.anthropicBaseUrl).toBe("https://api.anthropic.com/v1");

    expect(resolved.logFormat).toBe("logfmt");
    expect(resolved.replyTimeoutMs).toBe(180000);
  });

  test("setConfigValue rejects internal config keys", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "", "utf8");

    await expect(setConfigValue("bogus", "value", { env: { HOME: home }, cwd: home })).rejects.toThrow(
      "Unknown config key",
    );
  });

  test("embeddingBaseUrl is user-scoped", async () => {
    const home = createDir("acolyte-config-home-");
    await expect(
      setConfigValue("embeddingBaseUrl", "https://embeddings.example.com/v1", {
        env: { HOME: home },
        cwd: home,
        scope: "project",
      }),
    ).rejects.toThrow("embeddingBaseUrl is user-scoped");
  });

  test("setConfigValue supports locale", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "", "utf8");

    await setConfigValue("locale", "en", { env: { HOME: home }, cwd: home });
    const loaded = readConfigSync({ env: { HOME: home }, cwd: home });
    expect(loaded.locale).toBe("en");
  });

  test("setConfigValue supports dotted feature flags keys", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "", "utf8");

    await setConfigValue("features.undoCheckpoints", "true", { env: { HOME: home }, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain("[features]");
    expect(rawToml).toContain("undoCheckpoints = true");

    const resolved = readResolvedConfigSync({ env: { HOME: home }, cwd: home });
    expect(resolved.features.undoCheckpoints).toBe(true);
  });

  test("unsetConfigValue supports dotted feature flags keys", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = configDir({ HOME: home });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), ["[features]", "undoCheckpoints = true"].join("\n"), "utf8");

    await unsetConfigValue("features.undoCheckpoints", { env: { HOME: home }, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).not.toContain("[features]");

    const resolved = readResolvedConfigSync({ env: { HOME: home }, cwd: home });
    expect(resolved.features.undoCheckpoints).toBe(false);
  });

  test("project features merge with user features instead of replacing", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = configDir({ HOME: home });
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), ["[features]", "undoCheckpoints = true"].join("\n"), "utf8");
    writeFileSync(join(projectDataDir, "config.toml"), ["[features]", "cloudSync = true"].join("\n"), "utf8");

    const loaded = await readConfig({ env: { HOME: home }, cwd: project });
    expect(loaded.features?.undoCheckpoints).toBe(true);
    expect(loaded.features?.cloudSync).toBe(true);
  });

  test("project config overrides user config", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = configDir({ HOME: home });
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(
      join(userDataDir, "config.toml"),
      ['model = "openai/gpt-5-mini"', "replyTimeoutMs = 120000"].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(projectDataDir, "config.toml"),
      ['model = "anthropic/claude-sonnet-4"', "replyTimeoutMs = 200000"].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ env: { HOME: home }, cwd: project });
    expect(loaded.model).toBe("anthropic/claude-sonnet-4");
    expect(loaded.replyTimeoutMs).toBe(200000);
  });

  test("project config does not clear user values when project key is missing", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = configDir({ HOME: home });
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), ["port = 7777", 'model = "openai/gpt-5-mini"'].join("\n"), "utf8");
    writeFileSync(join(projectDataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n', "utf8");

    const loaded = await readConfig({ env: { HOME: home }, cwd: project });
    expect(loaded.model).toBe("anthropic/claude-sonnet-4");
    expect(loaded.port).toBe(7777);
  });

  test("setConfigValue writes to project scope without mutating user scope", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = configDir({ HOME: home });
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");
    await setConfigValue("model", "anthropic/claude-sonnet-4", { env: { HOME: home }, cwd: project, scope: "project" });

    const userToml = readFileSync(join(userDataDir, "config.toml"), "utf8");
    const projectToml = readFileSync(join(projectDataDir, "config.toml"), "utf8");
    expect(userToml).toContain('model = "openai/gpt-5-mini"');
    expect(projectToml).toContain('model = "anthropic/claude-sonnet-4"');
  });

  test("setConfigValue validates external values with zod", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    await expect(setConfigValue("port", "not-a-number", { env: { HOME: home }, cwd: project })).rejects.toThrow(
      "Invalid port: not-a-number. Use a whole number.",
    );

    await expect(setConfigValue("reasoning", "extreme", { env: { HOME: home }, cwd: project })).rejects.toThrow(
      "Invalid reasoning: extreme. Use low, medium, or high.",
    );
    await expect(setConfigValue("locale", "xx", { env: { HOME: home }, cwd: project })).rejects.toThrow(
      "Invalid locale: xx. Use en, fi, or sv.",
    );
  });

  test("setConfigValue supports top-level reasoning", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(projectDataDir, { recursive: true });

    await setConfigValue("reasoning", "high", { env: { HOME: home }, cwd: project, scope: "project" });

    const loaded = await readConfigForScope("project", { env: { HOME: home }, cwd: project });
    expect(loaded.reasoning).toBe("high");
  });

  test("unsetConfigValue removes reasoning key", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(projectDataDir, { recursive: true });

    await setConfigValue("reasoning", "medium", { env: { HOME: home }, cwd: project, scope: "project" });
    await unsetConfigValue("reasoning", { env: { HOME: home }, cwd: project, scope: "project" });

    const loaded = await readConfigForScope("project", { env: { HOME: home }, cwd: project });
    expect(loaded.reasoning).toBeUndefined();
  });

  test("unsetConfigValue removes key only from targeted project scope", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = configDir({ HOME: home });
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), "port = 6767\n", "utf8");
    writeFileSync(join(projectDataDir, "config.toml"), "port = 7777\n", "utf8");

    await unsetConfigValue("port", { env: { HOME: home }, cwd: project, scope: "project" });

    const userToml = readFileSync(join(userDataDir, "config.toml"), "utf8");
    const projectToml = readFileSync(join(projectDataDir, "config.toml"), "utf8");
    expect(userToml).toContain("port = 6767");
    expect(projectToml).not.toContain("port =");
  });
});
