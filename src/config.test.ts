import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readConfig,
  readConfigSync,
  readResolvedConfigSync,
  setConfigValue,
  unsetConfigValue,
  writeConfig,
} from "./config";

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

    const loaded = await readConfig({ homeDir: home, cwd: home });
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

    const loaded = await readConfig({ homeDir: home, cwd: home });
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

    const loaded = await readConfig({ homeDir: home, cwd: home });
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

    const loaded = await readConfig({ homeDir: home, cwd: home });
    expect(loaded).toEqual({
      model: "openai/gpt-5-mini",
      apiUrl: "http://localhost:6767",
    });
  });

  test("readConfigSync prefers TOML over JSON", () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "gemini/gemini-2.5-pro"', "utf8");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ model: "openai/gpt-5-mini" }, null, 2), "utf8");

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded.model).toBe("gemini/gemini-2.5-pro");
  });

  test("readConfigSync falls back to empty config on parse errors", () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "not valid toml = {", "utf8");

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded).toEqual({});
  });

  test("setConfigValue updates TOML when config.toml exists", async () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "openai/gpt-5-mini"\n', "utf8");

    await setConfigValue("apiUrl", "http://localhost:6767", { homeDir: home, cwd: home });
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

    await unsetConfigValue("apiUrl", { homeDir: home, cwd: home });
    const rawToml = readFileSync(join(dataDir, "config.toml"), "utf8");
    expect(rawToml).toContain('model = "openai/gpt-5-mini"');
    expect(rawToml).not.toContain("apiUrl =");
  });

  test("writeConfig sanitizes unexpected secret fields before persisting", async () => {
    const home = createTempDir("acolyte-config-home-");
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
    const home = createTempDir("acolyte-config-home-");
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
    const home = createTempDir("acolyte-config-home-");
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
        "omObservationTokens = 3500",
        "omReflectionTokens = 9000",
        "contextMaxTokens = 7000",
        "maxHistoryMessages = 50",
        "maxMessageTokens = 700",
        "maxAttachmentMessageTokens = 4500",
        "maxPinnedMessageTokens = 1600",
      ].join("\n"),
      "utf8",
    );

    const loaded = readConfigSync({ homeDir: home, cwd: home });
    expect(loaded.port).toBe(7777);
    expect(loaded.model).toBe("openai/gpt-5-mini");
    expect(loaded.permissionMode).toBe("write");
    expect(loaded.logFormat).toBe("json");
    expect(loaded.maxMessageTokens).toBe(700);
  });

  test("readResolvedConfigSync applies defaults and omModel fallback", () => {
    const home = createTempDir("acolyte-config-home-");
    const dataDir = join(home, ".acolyte");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), 'model = "anthropic/claude-sonnet-4"\n', "utf8");

    const resolved = readResolvedConfigSync({ homeDir: home, cwd: home });
    expect(resolved.port).toBe(6767);
    expect(resolved.model).toBe("anthropic/claude-sonnet-4");
    expect(resolved.omModel).toBe("anthropic/claude-sonnet-4");
    expect(resolved.permissionMode).toBe("read");
    expect(resolved.logFormat).toBe("logfmt");
  });

  test("project config overrides user config", async () => {
    const home = createTempDir("acolyte-config-home-");
    const project = createTempDir("acolyte-config-project-");
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
    const home = createTempDir("acolyte-config-home-");
    const project = createTempDir("acolyte-config-project-");
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
    const home = createTempDir("acolyte-config-home-");
    const project = createTempDir("acolyte-config-project-");
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
    const home = createTempDir("acolyte-config-home-");
    const project = createTempDir("acolyte-config-project-");
    await expect(setConfigValue("maxMessageTokens", "not-a-number", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for maxMessageTokens",
    );
    await expect(setConfigValue("permissionMode", "admin", { homeDir: home, cwd: project })).rejects.toThrow(
      "Invalid value for permissionMode",
    );
  });

  test("unsetConfigValue removes key only from targeted project scope", async () => {
    const home = createTempDir("acolyte-config-home-");
    const project = createTempDir("acolyte-config-project-");
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
