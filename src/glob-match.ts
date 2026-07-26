type Token =
  | { kind: "literal"; text: string }
  | { kind: "class"; negated: boolean; source: string }
  | { kind: "any" } // ? — one character, never a separator
  | { kind: "star" } // * — any run within one segment
  | { kind: "globstar" } // ** — any run, separators included
  | { kind: "globstarSlash" }; // /**/ — a separator, then zero or more directories

const TOKEN_PATTERN = /\/\*\*\/|\/\*\*|\*\*|\*|\?|\[[^\]]*\]|\[|[^*?[/]+|\//g;

export function tokenizeGlob(glob: string): Token[] {
  const tokens: Token[] = [];
  for (const [token] of glob.matchAll(TOKEN_PATTERN)) {
    if (token === "/**/") tokens.push({ kind: "globstarSlash" });
    else if (token === "/**") tokens.push({ kind: "literal", text: "/" }, { kind: "globstar" });
    else if (token === "**") tokens.push({ kind: "globstar" });
    else if (token === "*") tokens.push({ kind: "star" });
    else if (token === "?") tokens.push({ kind: "any" });
    else if (token.startsWith("[") && token.endsWith("]") && token.length > 2) {
      const negated = token[1] === "!" || token[1] === "^";
      const source = token.slice(negated ? 2 : 1, -1);
      assertClassRanges(source, token);
      tokens.push({ kind: "class", negated, source });
    } else tokens.push({ kind: "literal", text: token });
  }
  return tokens;
}

/** An out-of-order range is rejected rather than silently never matching, as the old compile step did. */
function assertClassRanges(source: string, token: string): void {
  for (let i = 0; i + 2 < source.length; i++) {
    if (source[i + 1] !== "-") continue;
    if ((source[i] ?? "") > (source[i + 2] ?? "")) throw new Error(`Invalid character class: ${token}`);
    i += 2;
  }
}

/**
 * Matched by walking tokens with a visited set rather than by compiling to a regex: glob wildcards
 * translate to adjacent `.*`/`[^/]*` groups, which backtrack catastrophically on a model-supplied
 * pattern — `*a` nine times took 7.8s against one path. The visited set makes the work O(tokens x path).
 */
export function createGlobMatcher(glob: string, anchored: boolean, caseInsensitive = false): (path: string) => boolean {
  // A leading `**/` means zero or more directories, which is exactly where an unanchored match may start.
  const leadingGlobstar = glob.startsWith("**/");
  const startAnywhere = leadingGlobstar || !anchored;
  const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const tokens = tokenizeGlob(leadingGlobstar ? glob.slice(3) : glob).map((token) => {
    if (token.kind === "literal") return { ...token, text: fold(token.text) };
    if (token.kind === "class") return { ...token, source: fold(token.source) };
    return token;
  });
  return (path) => {
    const subject = fold(path);
    const visited = new Set<number>();
    for (const start of startPositions(subject, !startAnywhere)) {
      if (matchFrom(tokens, 0, subject, start, visited)) return true;
    }
    return false;
  };
}

/** An unanchored pattern may start at the path root or after any separator. */
function startPositions(path: string, anchored: boolean): number[] {
  if (anchored) return [0];
  const positions = [0];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "/") positions.push(i + 1);
  }
  return positions;
}

function matchFrom(tokens: Token[], ti: number, path: string, si: number, visited: Set<number>): boolean {
  const key = ti * (path.length + 1) + si;
  if (visited.has(key)) return false;
  visited.add(key);

  const token = tokens[ti];
  if (!token) return si === path.length || path[si] === "/"; // trailing (/|$) — a match may end at a segment edge

  switch (token.kind) {
    case "literal":
      return path.startsWith(token.text, si) && matchFrom(tokens, ti + 1, path, si + token.text.length, visited);
    case "any":
      return si < path.length && path[si] !== "/" && matchFrom(tokens, ti + 1, path, si + 1, visited);
    case "class":
      return (
        si < path.length && matchesClass(token, path[si] ?? "") && matchFrom(tokens, ti + 1, path, si + 1, visited)
      );
    case "star":
      return matchRun(tokens, ti, path, si, visited, false);
    case "globstar":
      return matchRun(tokens, ti, path, si, visited, true);
    case "globstarSlash": {
      if (path[si] !== "/") return false;
      for (let j = si + 1; j <= path.length; j++) {
        if (matchFrom(tokens, ti + 1, path, j, visited)) return true;
        if (j < path.length && path[j] === "/" && matchFrom(tokens, ti + 1, path, j + 1, visited)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

function matchRun(
  tokens: Token[],
  ti: number,
  path: string,
  si: number,
  visited: Set<number>,
  crossSeparators: boolean,
): boolean {
  for (let j = si; j <= path.length; j++) {
    if (matchFrom(tokens, ti + 1, path, j, visited)) return true;
    if (j < path.length && !crossSeparators && path[j] === "/") break;
  }
  return false;
}

function matchesClass(token: { negated: boolean; source: string }, char: string): boolean {
  if (char === "/") return false;
  let inClass = false;
  for (let i = 0; i < token.source.length; i++) {
    const from = token.source[i] ?? "";
    if (token.source[i + 1] === "-" && i + 2 < token.source.length) {
      const to = token.source[i + 2] ?? "";
      if (char >= from && char <= to) inClass = true;
      i += 2;
      continue;
    }
    if (char === from) inClass = true;
  }
  return token.negated ? !inClass : inClass;
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
  const matchers = expandBraces(normalized).map(compileGlob);
  return (path) => matchers.some((matches) => matches(path));
}

/** Anchoring is decided per expansion so a leading slash inside a brace alternative still anchors. */
function compileGlob(glob: string): (path: string) => boolean {
  const anchored = glob.startsWith("/");
  try {
    return createGlobMatcher(anchored ? glob.slice(1) : glob, anchored, true);
  } catch {
    throw new Error(`Invalid glob pattern: ${glob}`);
  }
}

/**
 * Brace alternation is expanded here rather than in the tokenizer because gitignore shares that
 * and git treats braces literally.
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
