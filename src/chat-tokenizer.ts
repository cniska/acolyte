type HighlightKind = "plain" | "code" | "bold" | "path";

export type HighlightToken = {
  text: string;
  kind: HighlightKind;
};

type TokenRule = {
  kind: Exclude<HighlightKind, "plain" | "path">;
  pattern: RegExp;
};

const TOKEN_RULES: TokenRule[] = [
  { kind: "code", pattern: /`[^`]+`/ },
  { kind: "bold", pattern: /\*\*[^*]+\*\*/ },
];

const COMBINED_TOKEN_PATTERN = new RegExp(`(${TOKEN_RULES.map((r) => r.pattern.source).join("|")})`, "g");

function looksLikePathRef(token: string): boolean {
  if (token.length === 0) return false;
  if (token.startsWith("@")) return false;
  const fileWithExt = /^(?:\.{1,2}\/)?[\w.-]+\.[\w-]+(?::\d+(?::\d+)?)?$/.test(token);
  const slashPath = /^(?:\.{1,2}\/|~\/)?[\w.-]+(?:\/[\w.-]+)+(?:\.[\w-]+)?(?::\d+(?::\d+)?)?$/.test(token);
  return fileWithExt || slashPath;
}

function classifyMatch(text: string): HighlightKind {
  for (const rule of TOKEN_RULES) {
    if (rule.pattern.test(text)) return rule.kind;
  }
  return "plain";
}

function tokenizePlainSegment(text: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const chunks = text.split(/(\s+)/).filter((c) => c.length > 0);
  for (const chunk of chunks) {
    if (/^\s+$/.test(chunk)) {
      tokens.push({ text: chunk, kind: "plain" });
      continue;
    }
    const core = chunk.replace(/^[("'`]+|[)",.;!?]+$/g, "");
    tokens.push({ text: chunk, kind: looksLikePathRef(core) ? "path" : "plain" });
  }
  return tokens;
}

export function tokenizeForHighlighting(line: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(COMBINED_TOKEN_PATTERN)) {
    const start = match.index;
    if (start > lastIndex) tokens.push(...tokenizePlainSegment(line.slice(lastIndex, start)));
    tokens.push({ text: match[0], kind: classifyMatch(match[0]) });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < line.length) tokens.push(...tokenizePlainSegment(line.slice(lastIndex)));
  return tokens;
}
