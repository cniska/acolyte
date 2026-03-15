import { readFile } from "node:fs/promises";
import { join } from "node:path";

type CompiledPattern = {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
};

export type GitignoreContext = {
  patterns: CompiledPattern[];
  dir: string;
};

function escapeRegex(char: string): string {
  return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string, anchored: boolean): string {
  let re = anchored ? "^" : "(^|/)";

  if (glob.startsWith("**/")) {
    re += "(.+/)?"; // leading **/ — any number of leading directories
    glob = glob.slice(3);
  }

  for (const [token] of glob.matchAll(/\/\*\*\/|\/\*\*|\*\*|\*|\?|\[[^\]]*\]|\[|[^*?[/]+|\//g)) {
    switch (token) {
      case "/**/":
        re += "/(.+/)?";
        break; // zero or more intermediate directories
      case "/**":
        re += "/.*";
        break; // slash + anything
      case "**":
        re += ".*";
        break; // anything including slashes
      case "*":
        re += "[^/]*";
        break; // anything within one segment
      case "?":
        re += "[^/]";
        break; // exactly one non-separator character
      default:
        re += token.startsWith("[") && token.endsWith("]") ? token : escapeRegex(token);
    }
  }

  re += "(/|$)";
  return re;
}

type ParsedPattern = {
  glob: string;
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
};

function parseGitignorePattern(raw: string): ParsedPattern | null {
  let p = raw.trim();

  if (!p || p.startsWith("#")) return null;
  if (p.startsWith("\\#")) p = p.slice(1); // escaped hash → literal #

  const negated = p.startsWith("!");
  if (negated) p = p.slice(1).trim();
  if (!p) return null;

  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);

  const hasLeadingSlash = p.startsWith("/");
  if (hasLeadingSlash) p = p.slice(1);
  const anchored = hasLeadingSlash || p.includes("/");

  return { glob: p, negated, dirOnly, anchored };
}

function compileGitignorePattern(raw: string): CompiledPattern | null {
  const parsed = parseGitignorePattern(raw);
  if (!parsed) return null;
  try {
    const regex = new RegExp(globToRegex(parsed.glob, parsed.anchored));
    return { regex, negated: parsed.negated, dirOnly: parsed.dirOnly };
  } catch {
    return null;
  }
}

export function compileGitignorePatterns(lines: string[]): CompiledPattern[] {
  const out: CompiledPattern[] = [];
  for (const line of lines) {
    const compiled = compileGitignorePattern(line);
    if (compiled) out.push(compiled);
  }
  return out;
}

export function isIgnoredByPatterns(contexts: GitignoreContext[], absPath: string, isDir: boolean): boolean {
  let ignored = false;

  for (const ctx of contexts) {
    // Compute path relative to the gitignore's directory
    const prefix = ctx.dir.endsWith("/") ? ctx.dir : `${ctx.dir}/`;
    if (!absPath.startsWith(prefix)) continue;
    const rel = absPath.slice(prefix.length);

    for (const pattern of ctx.patterns) {
      if (pattern.dirOnly && !isDir) continue;
      if (pattern.regex.test(rel)) {
        ignored = !pattern.negated;
      }
    }
  }

  return ignored;
}

export async function loadGitignoreContext(dir: string): Promise<GitignoreContext | null> {
  const lines: string[] = [];

  try {
    const content = await readFile(join(dir, ".gitignore"), "utf8");
    lines.push(...content.split("\n"));
  } catch {
    // File does not exist — skip
  }

  const patterns = compileGitignorePatterns(lines);
  if (patterns.length === 0) return null;
  return { patterns, dir };
}
