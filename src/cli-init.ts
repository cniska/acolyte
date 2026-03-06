import type { readFile as readFileType, writeFile as writeFileType } from "node:fs/promises";
import { join } from "node:path";
import { t } from "./i18n";
import {
  type Provider,
  type ProviderApiEnvKey,
  providerApiEnvKeyByProvider,
  providerApiEnvKeySchema,
  providerSchema,
} from "./provider-contract";

const PROVIDER_ENV_KEYS: readonly ProviderApiEnvKey[] = providerApiEnvKeySchema.options;
const initProviderSchema = providerSchema;

type InitModeDeps = {
  cwd: () => string;
  hasHelpFlag: (args: string[]) => boolean;
  prompt: (question: string) => string | null;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readFile: typeof readFileType;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
  writeFile: typeof writeFileType;
};

function parseInitProvider(value: string | undefined): InitProvider | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = initProviderSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

type InitProvider = Provider;

function envKeyForProvider(provider: InitProvider): ProviderApiEnvKey {
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

export async function initMode(args: string[], deps: InitModeDeps): Promise<void> {
  const {
    cwd,
    hasHelpFlag,
    printDim,
    printError,
    prompt: promptFn,
    readFile,
    subcommandError,
    subcommandHelp,
    writeFile,
  } = deps;
  if (hasHelpFlag(args)) {
    subcommandHelp("init");
    return;
  }
  if (args.length > 1) {
    subcommandError("init");
    return;
  }

  let provider = parseInitProvider(args[0]);
  if (!provider) provider = parseInitProvider(promptFn(t("cli.init.prompt.provider"))?.trim() ?? undefined);
  if (!provider) {
    printError(t("cli.init.provider.invalid"));
    process.exitCode = 1;
    return;
  }

  const envKey = envKeyForProvider(provider);
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
  await writeFile(envPath, next, "utf8");

  printDim(t("cli.init.saved", { envKey, path: envPath }));
  printDim(t("cli.init.next"));
}
