import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AcolyteConfig {
  model?: string;
  apiUrl?: string;
  apiKey?: string;
}

type ConfigOptions = {
  homeDir?: string;
};

function toConfig(input: Record<string, unknown>): AcolyteConfig {
  return {
    model: typeof input.model === "string" ? input.model : undefined,
    apiUrl: typeof input.apiUrl === "string" ? input.apiUrl : undefined,
    apiKey: typeof input.apiKey === "string" ? input.apiKey : undefined,
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

export async function writeConfig(config: AcolyteConfig, options?: ConfigOptions): Promise<void> {
  const paths = resolvePaths(options);
  await mkdir(paths.dataDir, { recursive: true });
  await writeFile(paths.jsonPath, JSON.stringify(config, null, 2), "utf8");
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
  resolvePaths,
};
