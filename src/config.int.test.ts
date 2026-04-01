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
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("config store", () => {
  test("reads non-secret settings from config.toml", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      ['model = "anthropic/claude-sonnet-4"', "port = 7777"].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded).toEqual({
      model: "anthropic/claude-sonnet-4",
      port: 7777,
    });
  });

  test("ignores apiKey in file config (secrets are env-only)", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      ['model = "openai/gpt-5-mini"', "port = 7777", 'apiKey = "secret-should-be-ignored"'].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      port: 7777,
    });
  });

  test("prefers config.toml when both TOML and JSON exist", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "google/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded.model).toBe("google/gemini-2.5-pro");
  });

  test("falls back to JSON when TOML is absent", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ model: "openai/gpt-5-mini", port: 7777 }, null, 2),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      port: 7777,
    });
  });

  test("readConfigSync prefers TOML over JSON", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "google/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded.model).toBe("google/gemini-2.5-pro");
  });

  test("readConfigSync falls back to empty config on parse errors", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "not valid toml = {", "utf8");

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded).toEqual({});
  });

  test("setConfigValue updates TOML when config.toml exists", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");

    await setConfigValue("port", "7777", { homeDir: home, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain("port = 7777");
  });

  test("unsetConfigValue removes field from TOML when config.toml exists", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\nport = 7777\n', "utf8");

    await unsetConfigValue("port", { homeDir: home, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).not.toContain("port =");
  });

  test("writeConfig sanitizes unexpected secret fields before persisting", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");

    await writeConfig(
      {
        model: "openai/gpt-5-mini",
        port: 7777,
        ...({ apiKey: "secret-should-not-persist" } as unknown as Record<string, string>),
      } as unknown as { model: string; port: number; apiKey: string },
      { homeDir: home, cwd: home },
    );
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain("port = 7777");
    expect(rawToml).not.toContain("apiKey");
  });

  test("writeConfig writes TOML by default when only JSON existed", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    await writeConfig(
      {
        model: "openai/gpt-5-mini",
        port: 7777,
      },
      { homeDir: home, cwd: home },
    );

    expect(existsSync(join(dataDir, "config.toml"))).toBe(true);
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain("port = 7777");
  });

  test("reads non-secret runtime knobs from config.toml", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
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
        'transportMode = "rpc"',
        "temperature = 0.3",
        "distillMessageThreshold = 25",
        "distillReflectionThresholdTokens = 9000",
        "distillMaxOutputTokens = 1500",
        "memoryBudgetTokens = 1500",
        "contextMaxTokens = 7000",
        "maxHistoryMessages = 50",
        "maxMessageTokens = 700",
        "maxAttachmentMessageTokens = 4500",
        "maxPinnedMessageTokens = 1600",
        "replyTimeoutMs = 220000",
      ].join("\n"),
      "utf8",
    );

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded.port).toBe(7777);
    expect(loaded.locale).toBe("en");
    expect(loaded.model).toBe("openai/gpt-5-mini");

    expect(loaded.logFormat).toBe("json");
    expect(loaded.transportMode).toBe("rpc");
    expect(loaded.temperature).toBe(0.3);
    expect(loaded.maxMessageTokens).toBe(700);
    expect(loaded.replyTimeoutMs).toBe(220000);
  });

  test("readResolvedConfigSync applies defaults and model fallbacks", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n', "utf8");

    const resolved = readResolvedConfigSync({ homeDir: home, cwd: home });
    expect(resolved.port).toBe(6767);
    expect(resolved.locale).toBe("en");
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.temperature).toBeUndefined();
    expect(resolved.distillModel).toBe("anthropic/claude-sonnet-4");
    expect(resolved.anthropicBaseUrl).toBe("https://api.anthropic.com/v1");

    expect(resolved.logFormat).toBe("logfmt");
    expect(resolved.transportMode).toBe("rpc");
    expect(resolved.replyTimeoutMs).toBe(180000);
  });

  test("readResolvedConfigSync uses top-level temperature when set", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n\ntemperature = 0.2\n', "utf8");

    const resolved = readResolvedConfigSync({ homeDir: home, cwd: home });
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.temperature).toBe(0.2);
    expect(resolved.distillModel).toBe("anthropic/claude-sonnet-4");
  });

  test("readResolvedConfigSync uses top-level temperature from config", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n\ntemperature = 0.1\n', "utf8");

    const resolved = readResolvedConfigSync({ homeDir: home, cwd: home });
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.temperature).toBe(0.1);
  });

  test("setConfigValue rejects internal config keys", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "", "utf8");

    await expect(setConfigValue("bogus", "value", { homeDir: home, cwd: home })).rejects.toThrow("Unknown config key");
  });

  test("setConfigValue supports locale", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "", "utf8");

    await setConfigValue("locale", "en", { homeDir: home, cwd: home });
    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded.locale).toBe("en");
  });

  test("project config overrides user config", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(
      join(userDataDir, "config.toml"),
      ['model = "openai/gpt-5-mini"', "maxMessageTokens = 600"].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(projectDataDir, "config.toml"),
      ['model = "anthropic/claude-sonnet-4"', "maxMessageTokens = 700"].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home, cwd: project });
    expect(loaded.model).toBe("anthropic/claude-sonnet-4");
    expect(loaded.maxMessageTokens).toBe(700);
  });

  test("project config does not clear user values when project key is missing", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), ["port = 7777", 'model = "openai/gpt-5-mini"'].join("\n"), "utf8");
    writeFileSync(join(projectDataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n', "utf8");

    const loaded = await readConfig({ homeDir: home, cwd: project });
    expect(loaded.model).toBe("anthropic/claude-sonnet-4");
    expect(loaded.port).toBe(7777);
  });

  test("setConfigValue writes to project scope without mutating user scope", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");
    await setConfigValue("model", "anthropic/claude-sonnet-4", { homeDir: home, cwd: project, scope: "project" });

    const userToml = readFileSync(join(userDataDir, "config.toml"), "utf8");
    const projectToml = readFileSync(join(projectDataDir, "config.toml"), "utf8");
    expect(userToml).toContain('model = "openai/gpt-5-mini"');
    expect(projectToml).toContain('model = "anthropic/claude-sonnet-4"');
  });

  test("setConfigValue validates external values with zod", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    await expect(setConfigValue("port", "not-a-number", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for port",
    );

    await expect(setConfigValue("temperature", "3", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for temperature",
    );
    await expect(setConfigValue("locale", "xx", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for locale",
    );
  });

  test("setConfigValue supports top-level temperature", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(projectDataDir, { recursive: true });

    await setConfigValue("temperature", "0.2", { homeDir: home, cwd: project, scope: "project" });

    const loaded = await readConfigForScope("project", { homeDir: home, cwd: project });
    expect(loaded.temperature).toBe(0.2);
  });

  test("unsetConfigValue removes temperature key", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(projectDataDir, { recursive: true });

    await setConfigValue("temperature", "0.4", { homeDir: home, cwd: project, scope: "project" });
    await unsetConfigValue("temperature", { homeDir: home, cwd: project, scope: "project" });

    const loaded = await readConfigForScope("project", { homeDir: home, cwd: project });
    expect(loaded.temperature).toBeUndefined();
  });

  test("unsetConfigValue removes key only from targeted project scope", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), "port = 6767\n", "utf8");
    writeFileSync(join(projectDataDir, "config.toml"), "port = 7777\n", "utf8");

    await unsetConfigValue("port", { homeDir: home, cwd: project, scope: "project" });

    const userToml = readFileSync(join(userDataDir, "config.toml"), "utf8");
    const projectToml = readFileSync(join(projectDataDir, "config.toml"), "utf8");
    expect(userToml).toContain("port = 6767");
    expect(projectToml).not.toContain("port =");
  });
});
