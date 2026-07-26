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
  if (!normalized.startsWith("/") && !WILDCARD.test(normalized)) {
    const needle = normalized.toLowerCase();
    return (path) => path.toLowerCase().includes(needle);
  }
  const regexes = expandBraces(normalized).map(compileGlob);
  return (path) => regexes.some((regex) => regex.test(path));
}

/** Anchoring is decided per expansion so a leading slash inside a brace alternative still anchors. */
function compileGlob(glob: string): RegExp {
  const anchored = glob.startsWith("/");
  try {
    return new RegExp(globToRegex(anchored ? glob.slice(1) : glob, anchored), "i");
  } catch {
    throw new Error(`Invalid glob pattern: ${glob}`);
  }
}

/**
 * Brace alternation is expanded here rather than in `globToRegex` because gitignore shares that
 * compiler and git treats braces literally.
 */
export function expandBraces(pattern: string): string[] {
  const expansions: string[] = [];
  expandInto(pattern, pattern, expansions);
  return expansions;
}

/** Depth-first so the cap bounds the work done, not merely the result returned. */
function expandInto(pattern: string, original: string, expansions: string[]): void {
  if (expansions.length >= MAX_BRACE_ALTERNATIVES) {
    throw new Error(`Glob pattern expands to more than ${MAX_BRACE_ALTERNATIVES} alternatives: ${original}`);
  }
  const open = pattern.indexOf("{");
  const close = open === -1 ? -1 : matchingBrace(pattern, open);
  if (close === -1) {
    expansions.push(pattern); // no brace, or an unbalanced one that stays literal
    return;
  }
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  for (const alternative of splitAlternatives(pattern.slice(open + 1, close))) {
    expandInto(`${prefix}${alternative}${suffix}`, original, expansions);
  }
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
