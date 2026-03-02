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
      ['model = "anthropic/claude-sonnet-4"', 'apiUrl = "http://localhost:6767"'].join("\n"),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded).toEqual({
      model: "anthropic/claude-sonnet-4",
      apiUrl: "http://localhost:6767",
    });
  });

  test("ignores apiKey in file config (secrets are env-only)", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      ['model = "openai/gpt-5-mini"', 'apiUrl = "http://localhost:6767"', 'apiKey = "secret-should-be-ignored"'].join(
        "\n",
      ),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      apiUrl: "http://localhost:6767",
    });
  });

  test("prefers config.toml when both TOML and JSON exist", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "gemini/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded.model).toBe("gemini/gemini-2.5-pro");
  });

  test("falls back to JSON when TOML is absent", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ model: "openai/gpt-5-mini", apiUrl: "http://localhost:6767" }, null, 2),
      "utf8",
    );

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      apiUrl: "http://localhost:6767",
    });
  });

  test("readConfigSync prefers TOML over JSON", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "gemini/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded.model).toBe("gemini/gemini-2.5-pro");
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

    await setConfigValue("apiUrl", "http://localhost:6767", { homeDir: home, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain('apiUrl = "http://localhost:6767"');
  });

  test("unsetConfigValue removes field from TOML when config.toml exists", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      'model = "openai/gpt-5-mini"\napiUrl = "http://localhost:6767"\n',
      "utf8",
    );

    await unsetConfigValue("apiUrl", { homeDir: home, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).not.toContain("apiUrl =");
  });

  test("writeConfig sanitizes unexpected secret fields before persisting", async () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");

    await writeConfig(
      {
        model: "openai/gpt-5-mini",
        apiUrl: "http://localhost:6767",
        ...({ apiKey: "secret-should-not-persist" } as unknown as Record<string, string>),
      } as unknown as { model: string; apiUrl: string; apiKey: string },
      { homeDir: home, cwd: home },
    );
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain('apiUrl = "http://localhost:6767"');
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
        apiUrl: "http://localhost:6767",
      },
      { homeDir: home, cwd: home },
    );

    expect(existsSync(join(dataDir, "config.toml"))).toBe(true);
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).toContain('apiUrl = "http://localhost:6767"');
  });

  test("reads non-secret runtime knobs from config.toml", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      [
        "port = 7777",
        'model = "openai/gpt-5-mini"',
        'apiUrl = "http://localhost:6767"',
        'openaiBaseUrl = "https://openai.example.com/v1"',
        'anthropicBaseUrl = "https://anthropic.example.com"',
        'googleBaseUrl = "https://google.example.com"',
        'permissionMode = "write"',
        'logFormat = "json"',
        'transportMode = "rpc"',
        "temperatures.plan = 0.2",
        "temperatures.work = 0.3",
        "omObservationTokens = 3500",
        "omReflectionTokens = 9000",
        "contextMaxTokens = 7000",
        "maxHistoryMessages = 50",
        "maxMessageTokens = 700",
        "maxAttachmentMessageTokens = 4500",
        "maxPinnedMessageTokens = 1600",
        "replyTimeoutMs = 220000",
        'disabledGuards = ["duplicate-consecutive-call"]',
      ].join("\n"),
      "utf8",
    );

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded.port).toBe(7777);
    expect(loaded.model).toBe("openai/gpt-5-mini");
    expect(loaded.permissionMode).toBe("write");
    expect(loaded.logFormat).toBe("json");
    expect(loaded.transportMode).toBe("rpc");
    expect(loaded.temperatures).toEqual({ plan: 0.2, work: 0.3 });
    expect(loaded.maxMessageTokens).toBe(700);
    expect(loaded.replyTimeoutMs).toBe(220000);
    expect(loaded.disabledGuards).toEqual(["duplicate-consecutive-call"]);
  });

  test("readResolvedConfigSync applies defaults and model fallbacks", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n', "utf8");

    const resolved = readResolvedConfigSync({ homeDir: home, cwd: home });
    expect(resolved.port).toBe(6767);
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.models).toEqual({});
    expect(resolved.temperatures).toEqual({});
    expect(resolved.omModel).toBe("anthropic/claude-sonnet-4");
    expect(resolved.permissionMode).toBe("read");
    expect(resolved.logFormat).toBe("logfmt");
    expect(resolved.transportMode).toBe("auto");
    expect(resolved.replyTimeoutMs).toBe(180000);
    expect(resolved.disabledGuards).toEqual([]);
  });

  test("readResolvedConfigSync uses per-mode models when set", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      'model = "anthropic/claude-sonnet-4"\n\n[models]\nplan = "openai/gpt-5-mini"\n',
      "utf8",
    );

    const resolved = readResolvedConfigSync({ homeDir: home, cwd: home });
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.models).toEqual({ plan: "openai/gpt-5-mini" });
    expect(resolved.omModel).toBe("anthropic/claude-sonnet-4");
  });

  test("readResolvedConfigSync uses per-mode temperatures when set", () => {
    const home = createDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "config.toml"),
      'model = "anthropic/claude-sonnet-4"\n\ntemperatures.plan = 0.2\ntemperatures.verify = 0.1\n',
      "utf8",
    );

    const resolved = readResolvedConfigSync({ homeDir: home, cwd: home });
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.temperatures).toEqual({ plan: 0.2, verify: 0.1 });
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

    writeFileSync(
      join(userDataDir, "config.toml"),
      ['apiUrl = "http://localhost:6767"', 'model = "openai/gpt-5-mini"'].join("\n"),
      "utf8",
    );
    writeFileSync(join(projectDataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n', "utf8");

    const loaded = await readConfig({ homeDir: home, cwd: project });
    expect(loaded.model).toBe("anthropic/claude-sonnet-4");
    expect(loaded.apiUrl).toBe("http://localhost:6767");
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
    await expect(setConfigValue("maxMessageTokens", "not-a-number", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for maxMessageTokens",
    );
    await expect(setConfigValue("permissionMode", "admin", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for permissionMode",
    );
    await expect(setConfigValue("temperatures.plan", "3", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for temperatures.plan",
    );
  });

  test("setConfigValue supports per-mode temperatures through dotted keys", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(projectDataDir, { recursive: true });

    await setConfigValue("temperatures.plan", "0.2", { homeDir: home, cwd: project, scope: "project" });
    await setConfigValue("temperatures.work", "0.4", { homeDir: home, cwd: project, scope: "project" });

    const loaded = await readConfigForScope("project", { homeDir: home, cwd: project });
    expect(loaded.temperatures).toEqual({ plan: 0.2, work: 0.4 });
  });

  test("unsetConfigValue removes key only from targeted project scope", async () => {
    const home = createDir("acolyte-config-home-");
    const project = createDir("acolyte-config-project-");
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(projectDataDir, { recursive: true });

    writeFileSync(join(userDataDir, "config.toml"), 'apiUrl = "http://user.local"\n', "utf8");
    writeFileSync(join(projectDataDir, "config.toml"), 'apiUrl = "http://project.local"\n', "utf8");

    await unsetConfigValue("apiUrl", { homeDir: home, cwd: project, scope: "project" });

    const userToml = readFileSync(join(userDataDir, "config.toml"), "utf8");
    const projectToml = readFileSync(join(projectDataDir, "config.toml"), "utf8");
    expect(userToml).toContain('apiUrl = "http://user.local"');
    expect(projectToml).not.toContain("apiUrl =");
  });
});
