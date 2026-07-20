import { t } from "./i18n";
import {
  type Provider,
  type ProviderApiEnvKey,
  providerApiEnvKeyByProvider,
  providerSchema,
} from "./provider-contract";

type InitModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  prompt: (question: string) => string | null;
  promptHidden: (question: string) => Promise<string | undefined>;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readProviderApiKeys: () => Partial<Record<ProviderApiEnvKey, string>>;
  writeProviderApiKey: (envKey: ProviderApiEnvKey, value: string) => Promise<void>;
  credentialsPath: () => string;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

function parseInitProvider(value: string | undefined): Provider | null {
  if (!value || value.trim().length === 0) return null;
  const normalized = value.trim().toLowerCase();
  const parsed = providerSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

export async function initMode(args: string[], deps: InitModeDeps): Promise<void> {
  const {
    hasHelpFlag,
    printDim,
    printError,
    prompt: promptFn,
    promptHidden,
    readProviderApiKeys,
    writeProviderApiKey: writeKey,
    credentialsPath,
    commandError,
    commandHelp,
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

  const envKey = providerApiEnvKeyByProvider[provider];

  if (readProviderApiKeys()[envKey]) {
    const answer = promptFn(t("cli.init.override.confirm", { envKey }))?.trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      printDim(t("cli.init.override.cancelled"));
      return;
    }
  }

  const apiKey = await promptHidden(t("cli.init.prompt.api_key"));
  if (!apiKey) {
    printError(t("cli.init.api_key.empty", { envKey }));
    process.exitCode = 1;
    return;
  }

  await writeKey(envKey, apiKey);

  printDim(t("cli.init.saved", { envKey, path: credentialsPath() }));
  printDim(t("cli.init.next"));
}
