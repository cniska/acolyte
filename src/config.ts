import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AcolyteConfig {
  model?: string;
  apiUrl?: string;
}

type ConfigOptions = {
  homeDir?: string;
};

function toConfig(input: Record<string, unknown>): AcolyteConfig {
  return {
    model: typeof input.model === "string" ? input.model : undefined,
    apiUrl: typeof input.apiUrl === "string" ? input.apiUrl : undefined,
  };
}

function resolvePaths(options?: ConfigOptions): { dataDir: string; jsonPath: string; tomlPath: string } {
  const dataDir = join(options?.homeDir ?? homedir(), ".acolyte");
  return {
    dataDir,
    jsonPath: join(dataDir, "config.json"),
    tomlPath: join(dataDir, "config.toml"),
  };
}

function serializeToml(config: AcolyteConfig): string {
  const lines: string[] = [];
  if (config.model) {
    lines.push(`model = ${JSON.stringify(config.model)}`);
  }
  if (config.apiUrl) {
    lines.push(`apiUrl = ${JSON.stringify(config.apiUrl)}`);
  }
  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

export async function readConfig(options?: ConfigOptions): Promise<AcolyteConfig> {
  const paths = resolvePaths(options);
  try {
    if (existsSync(paths.tomlPath)) {
      const rawToml = await readFile(paths.tomlPath, "utf8");
      const parsedToml = Bun.TOML.parse(rawToml) as Record<string, unknown>;
      return toConfig(parsedToml);
    }
    if (existsSync(paths.jsonPath)) {
      const rawJson = await readFile(paths.jsonPath, "utf8");
      const parsedJson = JSON.parse(rawJson) as Record<string, unknown>;
      return toConfig(parsedJson);
    }
    return {};
  } catch {
    return {};
  }
}

export function readConfigSync(options?: ConfigOptions): AcolyteConfig {
  const paths = resolvePaths(options);
  try {
    if (existsSync(paths.tomlPath)) {
      const rawToml = readFileSync(paths.tomlPath, "utf8");
      const parsedToml = Bun.TOML.parse(rawToml) as Record<string, unknown>;
      return toConfig(parsedToml);
    }
    if (existsSync(paths.jsonPath)) {
      const rawJson = readFileSync(paths.jsonPath, "utf8");
      const parsedJson = JSON.parse(rawJson) as Record<string, unknown>;
      return toConfig(parsedJson);
    }
    return {};
  } catch {
    return {};
  }
}

export async function writeConfig(config: AcolyteConfig, options?: ConfigOptions): Promise<void> {
  const paths = resolvePaths(options);
  const sanitized = toConfig(config as Record<string, unknown>);
  await mkdir(paths.dataDir, { recursive: true });
  await writeFile(paths.tomlPath, serializeToml(sanitized), "utf8");
}

export async function setConfigValue(key: keyof AcolyteConfig, value: string, options?: ConfigOptions): Promise<void> {
  const current = await readConfig(options);
  const next: AcolyteConfig = { ...current, [key]: value };
  await writeConfig(next, options);
}

export async function unsetConfigValue(key: keyof AcolyteConfig, options?: ConfigOptions): Promise<void> {
  const current = await readConfig(options);
  const next: AcolyteConfig = { ...current };
  delete next[key];
  await writeConfig(next, options);
}
export const __internal = {
  toConfig,
  serializeToml,
  resolvePaths,
};
