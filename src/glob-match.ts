import { escapeRegex } from "./string-utils";

export function globToRegex(glob: string, anchored: boolean): string {
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
        re += token.startsWith("[") && token.endsWith("]") ? token.replace(/^\[!/, "[^") : escapeRegex(token);
    }
  }

  re += "(/|$)";
  return re;
}

const WILDCARD = /[*?[{]/;
const MAX_BRACE_ALTERNATIVES = 64;

/**
 * A wildcard-free pattern matches as a substring so a bare fragment still locates files; anything
 * else matches as a glob. Only a leading slash anchors — `tui/*.tsx` is meant to find nested files.
 */
export function createPathMatcher(pattern: string): (path: string) => boolean {
  const normalized = pattern.replace(/^\.\/+/, "");
  if (!WILDCARD.test(normalized)) {
    const needle = normalized.toLowerCase();
    return (path) => path.toLowerCase().includes(needle);
  }
  const anchored = normalized.startsWith("/");
  const regexes = expandBraces(anchored ? normalized.slice(1) : normalized).map((glob) => compileGlob(glob, anchored));
  return (path) => regexes.some((regex) => regex.test(path));
}

function compileGlob(glob: string, anchored: boolean): RegExp {
  try {
    return new RegExp(globToRegex(glob, anchored), "i");
  } catch {
    throw new Error(`Invalid glob pattern: ${glob}`);
  }
}

/**
 * Brace alternation is expanded here rather than in `globToRegex` because gitignore shares that
 * compiler and git treats braces literally.
 */
export function expandBraces(pattern: string): string[] {
  const expanded = expandFirstBrace(pattern);
  if (expanded.length > MAX_BRACE_ALTERNATIVES) {
    throw new Error(`Glob pattern expands to more than ${MAX_BRACE_ALTERNATIVES} alternatives: ${pattern}`);
  }
  return expanded;
}

function expandFirstBrace(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  const close = matchingBrace(pattern, open);
  if (close === -1) return [pattern]; // unbalanced — the brace stays a literal
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  return splitAlternatives(pattern.slice(open + 1, close)).flatMap((alternative) =>
    expandFirstBrace(`${prefix}${alternative}${suffix}`),
  );
}

function matchingBrace(pattern: string, open: number): number {
  let depth = 0;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}
