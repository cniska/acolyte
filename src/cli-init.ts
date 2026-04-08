import type { readFile as readFileType, writeFile as writeFileType } from "node:fs/promises";
import { join } from "node:path";
import { promptHidden } from "./cli-prompt-hidden";
import { upsertDotenvValue } from "./dotenv";
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

type InitModeDeps = {
  cwd: () => string;
  hasHelpFlag: (args: string[]) => boolean;
  prompt: (question: string) => string | null;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readFile: typeof readFileType;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  writeFile: typeof writeFileType;
};

function parseInitProvider(value: string | undefined): Provider | null {
  if (!value || value.trim().length === 0) return null;
  const normalized = value.trim().toLowerCase();
  const parsed = providerSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function envKeyForProvider(provider: Provider): ProviderApiEnvKey {
  return providerApiEnvKeyByProvider[provider];
}

function hasAnyProviderApiKey(existing: string): boolean {
  return PROVIDER_ENV_KEYS.some((key) => new RegExp(`^\\s*${key}\\s*=`, "m").test(existing));
}

export async function initMode(args: string[], deps: InitModeDeps): Promise<void> {
  const {
    cwd,
    hasHelpFlag,
    printDim,
    printError,
    prompt: promptFn,
    readFile,
    commandError,
    commandHelp,
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
  const next = upsertDotenvValue(existing, envKey, apiKey);
  await writeFile(envPath, next, { encoding: "utf8", mode: PRIVATE_FILE_MODE });

  printDim(t("cli.init.saved", { envKey, path: envPath }));
  printDim(t("cli.init.next"));
}
