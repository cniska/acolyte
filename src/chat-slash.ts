const CHAT_SLASH_COMMANDS = [
  "/new",
  "/permissions",
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
  "/permissions": ["/permissions read", "/permissions write"],
};

const SLASH_ALIASES: Record<string, string> = {
  "/session": "/sessions",
  "/rem": "/remember",
  "/mem": "/memory",
};

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
  return CHAT_SLASH_COMMANDS.includes(token as (typeof CHAT_SLASH_COMMANDS)[number]) || token in SLASH_ALIASES;
}

export function suggestSlashCommands(inputValue: string, max = 5): string[] {
  const value = inputValue.trim();
  if (!value.startsWith("/")) {
    return [];
  }
  const candidate = inputValue.trimStart();

  // Check subcommands: resolve alias first, then match against subcommand lists
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
      const matches = subs.filter((sub) => sub.startsWith(canonical));
      if (matches.length > 0) {
        return matches.slice(0, max);
      }
    }
  }

  const matches = CHAT_SLASH_COMMANDS.filter((command) => command.startsWith(value));
  if (matches.length > 0) {
    return matches.slice(0, max);
  }
  return [];
}

export function suggestClosestSlashCommand(inputValue: string, maxDistance = 2): string | null {
  const value = inputValue.trim();
  if (!value.startsWith("/")) {
    return null;
  }
  if (isKnownSlashToken(value)) {
    return null;
  }
  let best: { command: string; distance: number } | null = null;
  for (const command of CHAT_SLASH_COMMANDS) {
    const distance = editDistance(value, command);
    if (distance > maxDistance) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = { command, distance };
    }
  }
  return best?.command ?? null;
}

export function shouldAutocompleteSlashSubmit(inputValue: string, selectedSuggestion: string | undefined): boolean {
  if (!selectedSuggestion) {
    return false;
  }
  const trimmed = inputValue.trim();
  if (!trimmed.startsWith("/")) {
    return false;
  }
  if (trimmed.includes(" ")) {
    return false;
  }
  return trimmed !== selectedSuggestion;
}

export function applySlashSuggestion(selectedSuggestion: string): string {
  return `${selectedSuggestion} `;
}

export function resolveSlashAlias(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return value;
  }
  const [head, ...rest] = trimmed.split(/\s+/);
  const resolvedHead = SLASH_ALIASES[head] ?? head;
  if (rest.length === 0) {
    return resolvedHead;
  }
  return `${resolvedHead} ${rest.join(" ")}`;
}
