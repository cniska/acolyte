import type {
  readConfigForScope as readConfigForScopeType,
  readConfig as readConfigType,
  setConfigValue as setConfigValueType,
  unsetConfigValue as unsetConfigValueType,
} from "./config";
import { t } from "./i18n";

const CONFIG_LIST_KEY_COLUMN_WIDTH = 16;

type ConfigModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readConfig: typeof readConfigType;
  readConfigForScope: typeof readConfigForScopeType;
  setConfigValue: typeof setConfigValueType;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
  unsetConfigValue: typeof unsetConfigValueType;
};

const VALID_CONFIG_KEYS = [
  "port",
  "locale",
  "model",
  "models",
  "distillModel",
  "distillMessageThreshold",
  "distillReflectionThresholdTokens",
  "distillMaxOutputTokens",
  "memoryBudgetTokens",
  "memorySources",
  "apiUrl",
  "openaiBaseUrl",
  "anthropicBaseUrl",
  "googleBaseUrl",
  "permissionMode",
  "logFormat",
  "transportMode",
  "contextMaxTokens",
  "maxHistoryMessages",
  "maxMessageTokens",
  "maxAttachmentMessageTokens",
  "maxPinnedMessageTokens",
  "replyTimeoutMs",
] as const;

const VALID_CONFIG_KEY_SET = new Set<string>(VALID_CONFIG_KEYS);

function parseScopeFlag(token: string | undefined): "user" | "project" | null {
  if (token === "--user") return "user";
  if (token === "--project") return "project";
  return null;
}

export async function configMode(args: string[], deps: ConfigModeDeps): Promise<void> {
  const {
    hasHelpFlag,
    printDim,
    printError,
    readConfig,
    readConfigForScope,
    setConfigValue,
    subcommandError,
    subcommandHelp,
    unsetConfigValue,
  } = deps;
  if (hasHelpFlag(args)) {
    subcommandHelp("config");
    return;
  }
  const [subcommandRaw, ...restArgs] = args;
  const isImplicitList = !subcommandRaw || subcommandRaw === "--user" || subcommandRaw === "--project";
  const subcommand = isImplicitList ? "list" : subcommandRaw;
  const listArgs = isImplicitList && subcommandRaw ? [subcommandRaw, ...restArgs] : restArgs;

  switch (subcommand) {
    case "list": {
      const scope = parseScopeFlag(listArgs[0]);
      const config = scope ? await readConfigForScope(scope) : await readConfig();
      if (scope) printDim(`${`${t("cli.config.scope")}`.padEnd(CONFIG_LIST_KEY_COLUMN_WIDTH)} ${scope}`);
      for (const name of VALID_CONFIG_KEYS) {
        const value = config[name];
        if (value === undefined || value === "") continue;
        if (Array.isArray(value)) {
          printDim(`${`${name}:`.padEnd(CONFIG_LIST_KEY_COLUMN_WIDTH)} ${value.join(", ")}`);
        } else if (typeof value === "object" && value !== null) {
          for (const [k, v] of Object.entries(value)) {
            printDim(`${`${name}.${k}:`.padEnd(CONFIG_LIST_KEY_COLUMN_WIDTH)} ${String(v)}`);
          }
        } else {
          printDim(`${`${name}:`.padEnd(CONFIG_LIST_KEY_COLUMN_WIDTH)} ${String(value)}`);
        }
      }
      return;
    }
    case "set": {
      const scope = parseScopeFlag(restArgs[0]);
      const key = scope ? restArgs[1] : restArgs[0];
      const valueParts = scope ? restArgs.slice(2) : restArgs.slice(1);
      if (key === "apiKey") {
        printError(t("cli.config.api_key_unsupported"));
        process.exitCode = 1;
        return;
      }
      const isDottedKey = key?.includes(".") && VALID_CONFIG_KEY_SET.has(key.split(".")[0] ?? "");
      if (!key || (!VALID_CONFIG_KEY_SET.has(key) && !isDottedKey)) {
        subcommandError("config", t("cli.config.usage.set"));
        return;
      }

      const value = valueParts.join(" ").trim();
      if (!value) {
        printError(t("cli.config.value_empty"));
        process.exitCode = 1;
        return;
      }

      try {
        await setConfigValue(key, value, { scope: scope ?? "user" });
      } catch (error) {
        const message = error instanceof Error ? error.message : `Invalid value for ${key}`;
        printError(message);
        process.exitCode = 1;
        return;
      }
      printDim(t("cli.config.saved", { key, scope: scope ?? "user" }));
      return;
    }
    case "unset": {
      const scope = parseScopeFlag(restArgs[0]);
      const key = scope ? restArgs[1] : restArgs[0];
      if (key === "apiKey") {
        printError(t("cli.config.api_key_unsupported"));
        process.exitCode = 1;
        return;
      }
      const isDottedUnsetKey = key?.includes(".") && VALID_CONFIG_KEY_SET.has(key.split(".")[0] ?? "");
      if (!key || (!VALID_CONFIG_KEY_SET.has(key) && !isDottedUnsetKey)) {
        subcommandError("config", t("cli.config.usage.unset"));
        return;
      }

      await unsetConfigValue(key, { scope: scope ?? "user" });
      printDim(t("cli.config.removed", { key, scope: scope ?? "user" }));
      return;
    }
    default:
      subcommandError("config");
      printDim(t("cli.config.keys", { keys: VALID_CONFIG_KEYS.join(", ") }));
  }
}
