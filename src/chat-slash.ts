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
  "/remember",
  "/memory",
  "/tokens",
  "/exit",
] as const;

const SUB_COMMANDS: Record<string, string[]> = {
  "/memory": ["/memory list", "/memory add", "/memory all", "/memory user", "/memory project"],
  "/model": ["/model plan", "/model work", "/model verify"],
  "/permissions": ["/permissions read", "/permissions write"],
};

const SLASH_HELP: Record<string, string> = {
  "/new": t("chat.slash.help.new"),
  "/permissions": t("chat.slash.help.permissions"),
  "/permissions read": t("chat.slash.help.permissions.read"),
  "/permissions write": t("chat.slash.help.permissions.write"),
  "/model": t("chat.slash.help.model"),
  "/model plan": t("chat.slash.help.model.plan"),
  "/model work": t("chat.slash.help.model.work"),
  "/model verify": t("chat.slash.help.model.verify"),
  "/status": t("chat.slash.help.status"),
  "/sessions": t("chat.slash.help.sessions"),
  "/skills": t("chat.slash.help.skills"),
  "/resume": t("chat.slash.help.resume"),
  "/remember": t("chat.slash.help.remember"),
  "/memory": t("chat.slash.help.memory"),
  "/memory list": t("chat.slash.help.memory.list"),
  "/memory add": t("chat.slash.help.memory.add"),
  "/memory all": t("chat.slash.help.memory.all"),
  "/memory user": t("chat.slash.help.memory.user"),
  "/memory project": t("chat.slash.help.memory.project"),
  "/tokens": t("chat.slash.help.tokens"),
  "/exit": t("chat.slash.help.exit"),
};

const SUGGEST_MAX_DISTANCE = 2;

function allSlashCommands(): string[] {
  const skillCommands = getLoadedSkills().map((s) => `/${s.name}`);
  const subs = Object.values(SUB_COMMANDS).flat();
  return [...CHAT_SLASH_COMMANDS, ...subs, ...skillCommands];
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
  for (const subs of Object.values(SUB_COMMANDS)) {
    if (subs.includes(token)) return true;
  }
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
  const all = allSlashCommands();
  const prefixMatches = all.filter((command) => command.startsWith(candidate));
  if (prefixMatches.length > 0) return prefixMatches.slice(0, max);
  const fuzzy = all
    .map((command) => ({ command, distance: editDistance(candidate, command) }))
    .filter((item) => item.distance <= SUGGEST_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance);
  return fuzzy.map((item) => item.command).slice(0, max);
}

export function shouldAutocompleteSlashSubmit(inputValue: string, selectedSuggestion: string | undefined): boolean {
  if (!selectedSuggestion) return false;
  const trimmed = inputValue.trim();
  if (!trimmed.startsWith("/")) return false;
  return trimmed !== selectedSuggestion && selectedSuggestion.startsWith(trimmed);
}

export function slashCommandHelp(command: string): string {
  const help = SLASH_HELP[command];
  if (help) return help;
  if (command.startsWith("/") && getLoadedSkills().some((s) => `/${s.name}` === command))
    return t("chat.slash.help.skill");
  return "";
}
