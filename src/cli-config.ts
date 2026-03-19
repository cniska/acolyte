import { hasBoolFlag } from "./cli-args";
import { formatUsage } from "./cli-help";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import type {
  readConfigForScope as readConfigForScopeType,
  readConfig as readConfigType,
  setConfigValue as setConfigValueType,
  unsetConfigValue as unsetConfigValueType,
} from "./config";
import { CONFIG_SET_SCHEMAS } from "./config-contract";
import { t } from "./i18n";

type ConfigModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readConfig: typeof readConfigType;
  readConfigForScope: typeof readConfigForScopeType;
  setConfigValue: typeof setConfigValueType;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  unsetConfigValue: typeof unsetConfigValueType;
};

const VALID_CONFIG_KEYS = Object.keys(CONFIG_SET_SCHEMAS);
const VALID_CONFIG_KEY_SET = new Set<string>(VALID_CONFIG_KEYS);

function parseScopeFlag(token: string | undefined): "user" | "project" | null {
  if (token === "--user") return "user";
  if (token === "--project") return "project";
  return null;
}

function parseScopeArgs(args: string[]): { scope: "user" | "project" | null; rest: string[]; invalid: boolean } {
  let scope: "user" | "project" | null = null;
  const rest: string[] = [];
  for (const token of args) {
    const parsed = parseScopeFlag(token);
    if (!parsed) {
      rest.push(token);
      continue;
    }
    if (scope && scope !== parsed) return { scope: null, rest: [], invalid: true };
    scope = parsed;
  }
  return { scope, rest, invalid: false };
}

export async function configMode(args: string[], deps: ConfigModeDeps): Promise<void> {
  const {
    hasHelpFlag,
    printDim,
    printError,
    readConfig,
    readConfigForScope,
    setConfigValue,
    commandError,
    commandHelp,
    unsetConfigValue,
  } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("config");
    return;
  }
  const json = hasBoolFlag(args, "--json");
  const cleanArgs = args.filter((a) => a !== "--json");
  const [subcommandRaw, ...restArgs] = cleanArgs;
  const isImplicitList = !subcommandRaw || subcommandRaw === "--user" || subcommandRaw === "--project";
  const subcommand = isImplicitList ? "list" : subcommandRaw;
  const listArgs = isImplicitList && subcommandRaw ? [subcommandRaw, ...restArgs] : restArgs;

  switch (subcommand) {
    case "list": {
      const parsed = parseScopeArgs(listArgs);
      if (parsed.invalid) {
        commandError("config");
        return;
      }
      const scope = parsed.scope;
      const config = scope ? await readConfigForScope(scope) : await readConfig();
      const out: CliOutput = json ? createJsonOutput() : createTextOutput();
      const entries: Record<string, string | undefined>[] = [];
      if (scope) entries.push({ key: t("cli.config.scope"), value: scope });
      for (const name of VALID_CONFIG_KEYS) {
        const value = (config as Record<string, unknown>)[name];
        if (value === undefined || value === "") continue;
        if (Array.isArray(value)) {
          entries.push({ key: `${name}:`, value: value.join(", ") });
        } else if (typeof value === "object" && value !== null) {
          for (const [k, v] of Object.entries(value)) {
            entries.push({ key: `${name}.${k}:`, value: String(v) });
          }
        } else {
          entries.push({ key: `${name}:`, value: String(value) });
        }
      }
      for (const entry of entries) out.addRow(entry);
      const rendered = out.render();
      if (rendered) printDim(rendered);
      return;
    }
    case "set": {
      const parsed = parseScopeArgs(restArgs);
      if (parsed.invalid) {
        commandError("config", formatUsage("acolyte config set <key> <value>"));
        return;
      }
      const scope = parsed.scope;
      const key = parsed.rest[0];
      const valueParts = parsed.rest.slice(1);
      if (key === "apiKey") {
        printError(t("cli.config.api_key_unsupported"));
        process.exitCode = 1;
        return;
      }
      const isDottedKey = key?.includes(".") && VALID_CONFIG_KEY_SET.has(key.split(".")[0] ?? "");
      if (!key || (!VALID_CONFIG_KEY_SET.has(key) && !isDottedKey)) {
        commandError("config", formatUsage("acolyte config set <key> <value>"));
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
      const parsed = parseScopeArgs(restArgs);
      if (parsed.invalid) {
        commandError("config", formatUsage("acolyte config unset <key>"));
        return;
      }
      const scope = parsed.scope;
      const key = parsed.rest[0];
      if (key === "apiKey") {
        printError(t("cli.config.api_key_unsupported"));
        process.exitCode = 1;
        return;
      }
      const isDottedUnsetKey = key?.includes(".") && VALID_CONFIG_KEY_SET.has(key.split(".")[0] ?? "");
      if (!key || (!VALID_CONFIG_KEY_SET.has(key) && !isDottedUnsetKey)) {
        commandError("config", formatUsage("acolyte config unset <key>"));
        return;
      }

      await unsetConfigValue(key, { scope: scope ?? "user" });
      printDim(t("cli.config.removed", { key, scope: scope ?? "user" }));
      return;
    }
    default:
      commandError("config");
      printDim(t("cli.config.keys", { keys: VALID_CONFIG_KEYS.join(", ") }));
  }
}
