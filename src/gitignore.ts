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

// Convert a normalised gitignore glob (no leading/trailing slash, no ! prefix)
// to a regex string. `anchored` is true when the pattern must match from the
// root of the gitignore directory (i.e. it originally contained a slash).
function globToRegex(glob: string, anchored: boolean): string {
  // Anchored patterns match from the root; unanchored match at any path segment.
  let re = anchored ? "^" : "(^|/)";
  let i = 0;

  while (i < glob.length) {
    const ch = glob[i];

    // Detect /**/ and /** at the slash so the slash is consumed as part of the
    // double-star token rather than emitted as a literal separator.
    if (ch === "/" && glob[i + 1] === "*" && glob[i + 2] === "*") {
      if (glob[i + 3] === "/") {
        re += "/(.+/)?"; // /**/ — zero or more intermediate directories
        i += 4;
      } else {
        re += "/.*"; // /** — slash followed by anything
        i += 3;
      }
      continue;
    }

    if (ch === "*" && glob[i + 1] === "*") {
      if (i === 0 && glob[i + 2] === "/") {
        re += "(.+/)?"; // leading **/ — any number of leading directories
        i += 3;
      } else {
        re += ".*"; // bare ** — match everything including slashes
        i += 2;
      }
    } else if (ch === "*") {
      re += "[^/]*"; // single * — anything within one path segment
      i += 1;
    } else if (ch === "?") {
      re += "[^/]"; // ? — exactly one non-separator character
      i += 1;
    } else if (ch === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close === -1) {
        re += escapeRegex(ch); // unclosed bracket — treat as literal
        i += 1;
      } else {
        re += glob.slice(i, close + 1); // character class — pass through verbatim
        i = close + 1;
      }
    } else {
      re += escapeRegex(ch);
      i += 1;
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

// Parse a raw gitignore line into its component parts, or return null if the
// line should be skipped (blank, comment, or empty after stripping modifiers).
function parseGitignorePattern(raw: string): ParsedPattern | null {
  let p = raw.trim();

  if (!p || p.startsWith("#")) return null;
  if (p.startsWith("\\#")) p = p.slice(1); // escaped hash → literal #

  const negated = p.startsWith("!");
  if (negated) p = p.slice(1).trim();
  if (!p) return null;

  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);

  // A pattern is anchored when it contains a slash anywhere other than the
  // trailing slash already stripped above — or when it starts with a slash.
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
