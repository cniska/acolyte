type HighlightKind = "plain" | "code" | "path" | "command";

export type HighlightToken = {
  text: string;
  kind: HighlightKind;
};

const COMMAND_WORDS = new Set(["bun", "bunx", "git", "npm", "pnpm", "yarn", "node", "npx"]);

export function sanitizeAssistantContent(content: string): string {
  const cleaned = content
    .split("\n")
    .map((line) => line.replace(/^\s+(\d+\.\s)/, "$1"))
    .filter((line) => !/^\s*(Tools used:|Evidence:)/.test(line))
    .join("\n")
    .trimEnd();
  return cleaned.length > 0 ? cleaned : "No output.";
}

function looksLikePathRef(token: string): boolean {
  if (token.length === 0) {
    return false;
  }
  if (token.startsWith("@")) {
    return false;
  }
  const fileWithExt = /^(?:\.{1,2}\/)?[\w.-]+\.[\w-]+(?::\d+(?::\d+)?)?$/.test(token);
  const slashPath = /^(?:\.{1,2}\/|~\/)?[\w.-]+(?:\/[\w.-]+)+(?:\.[\w-]+)?(?::\d+(?::\d+)?)?$/.test(token);
  return fileWithExt || slashPath;
}

export function tokenizeForHighlighting(line: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const parts = line.split(/(`[^`]+`)/g).filter((part) => part.length > 0);
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      tokens.push({ text: part, kind: "code" });
      continue;
    }

    const chunks = part.split(/(\s+)/).filter((chunk) => chunk.length > 0);
    for (const chunk of chunks) {
      if (/^\s+$/.test(chunk)) {
        tokens.push({ text: chunk, kind: "plain" });
        continue;
      }

      const core = chunk.replace(/^[("'`]+|[)",.;!?]+$/g, "");
      if (COMMAND_WORDS.has(core.toLowerCase())) {
        tokens.push({ text: chunk, kind: "command" });
        continue;
      }
      if (looksLikePathRef(core)) {
        tokens.push({ text: chunk, kind: "path" });
        continue;
      }
      tokens.push({ text: chunk, kind: "plain" });
    }
  }
  return tokens;
}
