import type { readFile as readFileType, writeFile as writeFileType } from "node:fs/promises";
import { join } from "node:path";
import type { readConfigForScope as readConfigForScopeType, writeConfig as writeConfigType } from "./config";
import type { Config } from "./config-contract";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { t } from "./i18n";
import {
  type Provider,
  type ProviderApiEnvKey,
  providerApiEnvKeyByProvider,
  providerApiEnvKeySchema,
  providerSchema,
} from "./provider-contract";

const PROVIDER_ENV_KEYS: readonly ProviderApiEnvKey[] = providerApiEnvKeySchema.options;
const OLLAMA_BASE_URL = "http://localhost:11434/v1";

type InitTarget = Provider | "ollama";

function isProviderTarget(target: InitTarget): target is Provider {
  return target !== "ollama";
}

type InitModeDeps = {
  cwd: () => string;
  hasHelpFlag: (args: string[]) => boolean;
  prompt: (question: string) => string | null;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readFile: typeof readFileType;
  readConfigForScope: typeof readConfigForScopeType;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  writeConfig: typeof writeConfigType;
  writeFile: typeof writeFileType;
};

function parseInitTarget(value: string | undefined): InitTarget | null {
  if (!value || value.trim().length === 0) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "ollama") return "ollama";
  const parsed = providerSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function envKeyForProvider(provider: Provider): ProviderApiEnvKey {
  return providerApiEnvKeyByProvider[provider];
}

function upsertDotEnvValue(existing: string, key: string, value: string): string {
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const matcher = new RegExp(`^\\s*${key}\\s*=`);
  const nextLines: string[] = [];
  let replaced = false;

  for (const line of lines) {
    if (matcher.test(line)) {
      if (!replaced) {
        nextLines.push(`${key}=${value}`);
        replaced = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!replaced) nextLines.push(`${key}=${value}`);
  const cleaned = nextLines.filter((line, index, arr) => !(index === arr.length - 1 && line.trim() === ""));
  return `${cleaned.join("\n")}\n`;
}

function hasAnyProviderApiKey(existing: string): boolean {
  return PROVIDER_ENV_KEYS.some((key) => new RegExp(`^\\s*${key}\\s*=`, "m").test(existing));
}

async function promptHidden(question: string): Promise<string | undefined> {
  if (!process.stdin.isTTY) return prompt(question)?.trim();

  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          process.stdout.write("\n");
          cleanup();
          process.exitCode = 1;
          resolve(undefined);
          return;
        }
        if (char === "\r" || char === "\n") {
          process.stdout.write("\n");
          cleanup();
          resolve(value.trim());
          return;
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function applyOllamaPreset(config: Config): Config {
  return {
    ...config,
    openaiBaseUrl: OLLAMA_BASE_URL,
  };
}

export async function initMode(args: string[], deps: InitModeDeps): Promise<void> {
  const {
    cwd,
    hasHelpFlag,
    printDim,
    printError,
    prompt: promptFn,
    readFile,
    readConfigForScope,
    commandError,
    commandHelp,
    writeConfig,
    writeFile,
  } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("init");
    return;
  }
  if (args.length > 1) {
    commandError("init");
    return;
  }

  let target = parseInitTarget(args[0]);
  if (!target) target = parseInitTarget(promptFn(t("cli.init.prompt.provider"))?.trim() ?? undefined);
  if (!target) {
    printError(t("cli.init.provider.invalid"));
    process.exitCode = 1;
    return;
  }

  if (!isProviderTarget(target)) {
    const current = await readConfigForScope("project", { cwd: cwd() });
    const next = applyOllamaPreset(current);
    await writeConfig(next, { cwd: cwd(), scope: "project" });
    printDim(t("cli.init.saved_ollama_config", { path: join(cwd(), ".acolyte", "config.toml") }));
    printDim(t("cli.init.next_ollama"));
    return;
  }

  const envKey = envKeyForProvider(target);
  const apiKey = await promptHidden(t("cli.init.prompt.api_key"));
  if (!apiKey) {
    printError(t("cli.init.api_key.empty", { envKey }));
    process.exitCode = 1;
    return;
  }

  const envPath = join(cwd(), ".env");
  let existing = "";
  try {
    existing = await readFile(envPath, "utf8");
  } catch {
    existing = "";
  }
  if (hasAnyProviderApiKey(existing)) {
    printError(t("cli.init.api_key.exists"));
    process.exitCode = 1;
    return;
  }
  const next = upsertDotEnvValue(existing, envKey, apiKey);
  await writeFile(envPath, next, { encoding: "utf8", mode: PRIVATE_FILE_MODE });

  printDim(t("cli.init.saved", { envKey, path: envPath }));
  printDim(t("cli.init.next"));
}
