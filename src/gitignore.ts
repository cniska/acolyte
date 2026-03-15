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

function compileGitignorePattern(raw: string): CompiledPattern | null {
  let pattern = raw.trim();

  // Empty lines and comments
  if (!pattern || pattern.startsWith("#")) return null;

  // Escaped hash is a literal hash
  if (pattern.startsWith("\\#")) pattern = pattern.slice(1);

  // Negation
  const negated = pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1).trim();
  if (!pattern) return null;

  // Directory-only pattern
  const dirOnly = pattern.endsWith("/");
  if (dirOnly) pattern = pattern.slice(0, -1);

  // A pattern is anchored if it contains a slash anywhere (other than the
  // trailing slash already removed) — or has a leading slash.
  const hasLeadingSlash = pattern.startsWith("/");
  if (hasLeadingSlash) pattern = pattern.slice(1);
  const anchored = hasLeadingSlash || pattern.includes("/");

  // Convert gitignore glob syntax to a regex string.
  let regexStr = anchored ? "^" : "(^|/)";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    // /**/ and /** must be detected at the slash, so the slash is consumed as
    // part of the double-star sequence rather than emitted separately.
    if (ch === "/" && pattern[i + 1] === "*" && pattern[i + 2] === "*") {
      if (pattern[i + 3] === "/") {
        // /**/ — match a single slash or slash + one-or-more path segments + slash
        regexStr += "/(.+/)?";
        i += 4;
      } else {
        // /** at end — match slash and everything inside
        regexStr += "/.*";
        i += 3;
      }
      continue;
    }

    if (ch === "*" && pattern[i + 1] === "*") {
      if (i === 0 && pattern[i + 2] === "/") {
        // Leading **/ — match any number of leading directories
        regexStr += "(.+/)?";
        i += 3;
      } else {
        // Bare ** (no surrounding slashes) — match everything
        regexStr += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      regexStr += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i += 1;
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        regexStr += escapeRegex(ch);
        i += 1;
      } else {
        // Pass character classes through verbatim
        regexStr += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else {
      regexStr += escapeRegex(ch);
      i += 1;
    }
  }

  regexStr += "(/|$)";

  try {
    return { regex: new RegExp(regexStr), negated, dirOnly };
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

export function isIgnoredByPatterns(
  contexts: GitignoreContext[],
  absPath: string,
  isDir: boolean,
): boolean {
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
