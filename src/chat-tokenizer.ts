type MarkupTokenKind = "plain" | "code" | "bold" | "path";

export type MarkupToken = {
  text: string;
  kind: MarkupTokenKind;
};

type TokenRule = {
  kind: Exclude<MarkupTokenKind, "plain" | "path">;
  pattern: RegExp;
};

const TOKEN_RULES: TokenRule[] = [
  { kind: "code", pattern: /`[^`]+`/ },
  { kind: "bold", pattern: /\*\*[^*]+\*\*/ },
];

const COMBINED_TOKEN_PATTERN = new RegExp(`(${TOKEN_RULES.map((r) => r.pattern.source).join("|")})`, "g");

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonl",
  "py",
  "rs",
  "go",
  "rb",
  "java",
  "kt",
  "swift",
  "c",
  "cpp",
  "h",
  "hpp",
  "css",
  "scss",
  "html",
  "vue",
  "svelte",
  "md",
  "mdx",
  "yaml",
  "yml",
  "toml",
  "xml",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "test",
  "spec",
  "config",
  "lock",
  "env",
  "gitignore",
  "dockerignore",
]);

function looksLikePathRef(token: string): boolean {
  if (token.length === 0) return false;
  if (token.startsWith("@")) return false;
  const slashPath = /^(?:\.{1,2}\/|~\/)?[\w.-]+(?:\/[\w.-]+)+(?:\.[\w-]+)?(?::\d+(?::\d+)?)?$/.test(token);
  if (slashPath) return true;
  const fileMatch = token.match(/^(?:\.{1,2}\/)?([\w.-]+)\.([\w-]+)(?::\d+(?::\d+)?)?$/);
  if (!fileMatch) return false;
  const name = fileMatch[1] ?? "";
  if (/^[A-Z]/.test(name) && !name.includes("/") && !name.includes("-")) return false;
  return CODE_EXTENSIONS.has(fileMatch[2]?.toLowerCase() ?? "");
}

function classifyMatch(text: string): MarkupTokenKind {
  for (const rule of TOKEN_RULES) {
    if (rule.pattern.test(text)) return rule.kind;
  }
  return "plain";
}

function tokenizePlainSegment(text: string): MarkupToken[] {
  const tokens: MarkupToken[] = [];
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

export function tokenize(line: string): MarkupToken[] {
  const tokens: MarkupToken[] = [];
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
