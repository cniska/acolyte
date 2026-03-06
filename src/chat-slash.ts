import { t } from "./i18n";
import { getLoadedSkills } from "./skills";

const CHAT_SLASH_COMMANDS = [
  "/new",
  "/permissions",
  "/model",
  "/status",
  "/sessions",
  "/skills",
  "/resume",
  "/rem",
  "/remember",
  "/mem",
  "/memory",
  "/tokens",
  "/exit",
] as const;

const SUB_COMMANDS: Record<string, string[]> = {
  "/memory": ["/memory list", "/memory add", "/memory all", "/memory user", "/memory project"],
  "/model": ["/model plan", "/model work", "/model verify", "/model chat"],
  "/permissions": ["/permissions read", "/permissions write"],
};

const SLASH_HELP: Record<string, string> = {
  "/new": t("slash.help.new"),
  "/permissions": t("slash.help.permissions"),
  "/permissions read": t("slash.help.permissions.read"),
  "/permissions write": t("slash.help.permissions.write"),
  "/model": t("slash.help.model"),
  "/model plan": t("slash.help.model.plan"),
  "/model work": t("slash.help.model.work"),
  "/model verify": t("slash.help.model.verify"),
  "/model chat": t("slash.help.model.chat"),
  "/status": t("slash.help.status"),
  "/sessions": t("slash.help.sessions"),
  "/skills": t("slash.help.skills"),
  "/resume": t("slash.help.resume"),
  "/remember": t("slash.help.remember"),
  "/memory": t("slash.help.memory"),
  "/memory list": t("slash.help.memory.list"),
  "/memory add": t("slash.help.memory.add"),
  "/memory all": t("slash.help.memory.all"),
  "/memory user": t("slash.help.memory.user"),
  "/memory project": t("slash.help.memory.project"),
  "/tokens": t("slash.help.tokens"),
  "/exit": t("slash.help.exit"),
};

const SLASH_ALIASES: Record<string, string> = {
  "/session": "/sessions",
  "/rem": "/remember",
  "/mem": "/memory",
};
const SUGGEST_MIN_THRESHOLD = 2;

function allSlashCommands(): string[] {
  const skillCommands = getLoadedSkills().map((s) => `/${s.name}`);
  return [...CHAT_SLASH_COMMANDS, ...skillCommands];
}

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export function isKnownSlashToken(token: string): boolean {
  if (CHAT_SLASH_COMMANDS.includes(token as (typeof CHAT_SLASH_COMMANDS)[number])) return true;
  if (token in SLASH_ALIASES) return true;
  if (token.startsWith("/")) {
    const name = token.slice(1);
    return getLoadedSkills().some((s) => s.name === name);
  }
  return false;
}

export function suggestSlashCommands(inputValue: string, max = 5): string[] {
  const value = inputValue.trim();
  if (!value.startsWith("/")) return [];
  const candidate = inputValue.trimStart();

  // If input has a space, match subcommands only (resolve aliases first)
  if (candidate.includes(" ")) {
    for (const [parent, subs] of Object.entries(SUB_COMMANDS)) {
      const aliases = Object.entries(SLASH_ALIASES)
        .filter(([, v]) => v === parent)
        .map(([k]) => k);
      const prefixes = [parent, ...aliases];
      const isMatch = prefixes.some((p) => candidate.startsWith(`${p} `) || candidate === `${p} `);
      if (isMatch) {
        const canonical = candidate.replace(
          new RegExp(`^(${aliases.map((a) => a.replace("/", "\\/")).join("|")}) `),
          `${parent} `,
        );
        return subs.filter((sub) => sub.startsWith(canonical)).slice(0, max);
      }
    }
    return [];
  }

  // No space: match top-level commands + skill commands
  const all = allSlashCommands();
  const matches = all.filter((command) => command.startsWith(value));
  if (matches.length > 0) {
    if (matches.length === 1) {
      const [parent] = matches;
      const subs = SUB_COMMANDS[parent];
      const typedCommandChars = value.startsWith("/") ? value.length - 1 : value.length;
      const shouldExpandSubcommands = typedCommandChars >= SUGGEST_MIN_THRESHOLD;
      if (subs && shouldExpandSubcommands) {
        return [parent, ...subs].slice(0, max);
      }
    }
    return matches.slice(0, max);
  }

  // No prefix matches — fall back to fuzzy matching on top-level commands + skills
  const fuzzy = all
    .map((command) => ({ command, distance: editDistance(value, command) }))
    .filter((item) => item.distance <= SUGGEST_MIN_THRESHOLD)
    .sort((a, b) => a.distance - b.distance);
  return fuzzy.map((item) => item.command).slice(0, max);
}

export function suggestClosestSlashCommand(inputValue: string, maxDistance = 2): string | null {
  const value = inputValue.trim();
  if (!value.startsWith("/")) return null;
  if (isKnownSlashToken(value)) return null;
  let best: { command: string; distance: number } | null = null;
  for (const command of allSlashCommands()) {
    const distance = editDistance(value, command);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) best = { command, distance };
  }
  return best?.command ?? null;
}

export function shouldAutocompleteSlashSubmit(inputValue: string, selectedSuggestion: string | undefined): boolean {
  if (!selectedSuggestion) return false;
  const trimmed = inputValue.trim();
  if (!trimmed.startsWith("/")) return false;
  return trimmed !== selectedSuggestion && selectedSuggestion.startsWith(trimmed);
}

export function applySlashSuggestion(selectedSuggestion: string): string {
  return `${selectedSuggestion} `;
}

export function resolveSlashAlias(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return value;
  const [head, ...rest] = trimmed.split(/\s+/);
  const resolvedHead = SLASH_ALIASES[head] ?? head;
  if (rest.length === 0) return resolvedHead;
  return `${resolvedHead} ${rest.join(" ")}`;
}

export function slashCommandHelp(command: string): string {
  const help = SLASH_HELP[command];
  if (help) return help;
  if (command.startsWith("/") && getLoadedSkills().some((s) => `/${s.name}` === command)) return t("slash.help.skill");
  return "";
}
