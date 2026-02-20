export const CHAT_SLASH_COMMANDS = [
  "/changes",
  "/dogfood",
  "/df",
  "/ds",
  "/dogfood-status",
  "/new",
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

const SLASH_ALIASES: Record<string, string> = {
  "/df": "/dogfood",
  "/ds": "/dogfood-status",
  "/rem": "/remember",
  "/mem": "/memory",
};

export function isKnownSlashToken(token: string): boolean {
  return CHAT_SLASH_COMMANDS.includes(token as (typeof CHAT_SLASH_COMMANDS)[number]) || token in SLASH_ALIASES;
}

export function suggestSlashCommands(inputValue: string, max = 5): string[] {
  const value = inputValue.trim();
  if (!value.startsWith("/")) {
    return [];
  }
  const matches = CHAT_SLASH_COMMANDS.filter((command) => command.startsWith(value));
  if (matches.length > 0) {
    return matches.slice(0, max);
  }
  return [];
}

export function shouldAutocompleteSlashSubmit(
  inputValue: string,
  selectedSuggestion: string | undefined,
): boolean {
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
