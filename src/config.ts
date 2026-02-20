import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AcolyteConfig {
  model?: string;
  apiUrl?: string;
  apiKey?: string;
}

const DATA_DIR = join(homedir(), ".acolyte");
const CONFIG_PATH = join(DATA_DIR, "config.json");

export async function readConfig(): Promise<AcolyteConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }

  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as AcolyteConfig;
    return {
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : undefined,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : undefined,
    };
  } catch {
    return {};
  }
}

export async function writeConfig(config: AcolyteConfig): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export async function setConfigValue(key: keyof AcolyteConfig, value: string): Promise<void> {
  const current = await readConfig();
  const next: AcolyteConfig = { ...current, [key]: value };
  await writeConfig(next);
}

export async function unsetConfigValue(key: keyof AcolyteConfig): Promise<void> {
  const current = await readConfig();
  const next: AcolyteConfig = { ...current };
  delete next[key];
  await writeConfig(next);
}
