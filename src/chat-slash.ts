import { resolveCommandRegistry } from "./chat-command-registry";
import type { CommandSource } from "./chat-commands-contract";
import { tDynamic } from "./i18n";

export type SlashCommandRow = {
  /** What the user types to reach it, and what the completion menu offers. */
  command: string;
  /** The command with its argument form, for help and usage text. */
  usage: string;
  help: string;
  source: CommandSource;
};

/** Every reachable command string, derived from the registry so the menu can only offer what dispatch owns. */
export function slashCommandRows(): SlashCommandRow[] {
  const rows: SlashCommandRow[] = [];
  for (const entry of resolveCommandRegistry()) {
    const command = `/${entry.spec.name}`;
    const source = entry.spec.source;
    rows.push({ command, usage: entry.spec.usage ?? command, help: tDynamic(entry.spec.helpKey), source });
    for (const sub of entry.spec.subcommands) {
      rows.push({ command: `${command} ${sub.name}`, usage: sub.usage, help: tDynamic(sub.helpKey), source });
    }
  }
  return rows;
}

export function slashCommandHelp(command: string): string {
  return slashCommandRows().find((row) => row.command === command)?.help ?? "";
}

const SUGGEST_MAX_DISTANCE = 3;

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export function isKnownSlashToken(token: string): boolean {
  return slashCommandRows().some((row) => row.command === token);
}

/** Edit distance between `a` and `b` truncated to `a`'s length (tolerates partial input). */
function truncatedEditDistance(a: string, b: string): number {
  if (a.length >= b.length) return editDistance(a, b);
  return editDistance(a, b.slice(0, a.length));
}

function rootCommands(commands: string[]): string[] {
  return commands.filter((command) => !command.includes(" "));
}

function commandWithSubs(commands: string[], root: string): string[] {
  return commands.filter((command) => command === root || command.startsWith(`${root} `));
}

export function suggestSlashCommands(inputValue: string, max = 5): string[] {
  const value = inputValue.trim();
  if (!value.startsWith("/")) return [];
  const candidate = inputValue.trimStart();
  const all = slashCommandRows().map((row) => row.command);

  // Prefix matching (fast path)
  const prefixMatches = all.filter((command) => command.startsWith(candidate));
  if (prefixMatches.length > 0) return prefixMatches.slice(0, max);

  // Require at least 2 chars after "/" for fuzzy matching
  const parts = candidate.split(" ");
  if (parts[0].length < 3) return [];

  if (parts.length === 1) {
    // Single token: fuzzy-match against root commands, expand to include subcommands
    const fuzzy = rootCommands(all)
      .map((root) => ({ root, distance: truncatedEditDistance(candidate, root) }))
      .filter((item) => item.distance <= SUGGEST_MAX_DISTANCE)
      .sort((a, b) => a.distance - b.distance);
    return fuzzy.flatMap((item) => commandWithSubs(all, item.root)).slice(0, max);
  }

  // Multi-token: match first token against roots, second against subcommand words
  const [firstToken, ...rest] = parts;
  const subQuery = rest.join(" ");
  const matchedRoots = rootCommands(all)
    .filter((root) => editDistance(firstToken, root) <= SUGGEST_MAX_DISTANCE)
    .flatMap((root) => commandWithSubs(all, root));
  const subMatches = matchedRoots.filter((cmd) => {
    const cmdParts = cmd.split(" ");
    if (cmdParts.length < 2) return false;
    const sub = cmdParts.slice(1).join(" ");
    return sub.startsWith(subQuery) || editDistance(subQuery, sub) <= SUGGEST_MAX_DISTANCE;
  });
  return subMatches.slice(0, max);
}

export function shouldAutocompleteSlashSubmit(inputValue: string, selectedSuggestion: string | undefined): boolean {
  if (!selectedSuggestion) return false;
  const trimmed = inputValue.trim();
  if (!trimmed.startsWith("/")) return false;
  if (trimmed === selectedSuggestion) return false;
  if (trimmed.length > selectedSuggestion.length) return false;
  return true;
}
