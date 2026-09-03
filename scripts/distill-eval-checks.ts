/**
 * The programmatic half of the distiller yield eval: what can be decided about a recorded fact by
 * comparing it against the turn it came from, with no model in the loop and no verdict a judge
 * could talk out of. Semantics — whether a fact is a state, a plan, or perishable — is the judge's
 * half, in `distill-eval-judge.ts`.
 */

const SPELLED_FIGURES: ReadonlyMap<string, number> = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["dozen", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
]);

/**
 * Words that can follow a figure without being its unit, so a mismatch on them says nothing. The
 * list holds only function words and verb forms — never a noun — because a noun wrongly listed
 * here would hide exactly the corruption the pair check exists to catch, while a noun missing from
 * it costs nothing.
 */
const NON_UNIT_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "but",
  "by",
  "carries",
  "completed",
  "contains",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "includes",
  "including",
  "into",
  "is",
  "it",
  "must",
  "not",
  "of",
  "on",
  "or",
  "over",
  "past",
  "per",
  "remains",
  "requires",
  "resolves",
  "should",
  "so",
  "that",
  "the",
  "then",
  "to",
  "under",
  "was",
  "were",
  "which",
  "will",
  "with",
]);

const CODE_TOKEN_PATTERNS: readonly RegExp[] = [
  /`([^`]+)`/g,
  /(?<![\w-])(--[a-z][a-z0-9-]*)/gi,
  // camelCase, PascalCase and snake_case: an internal capital or underscore is what makes a word an
  // identifier rather than prose, so a name the turn never used cannot pass as ordinary language.
  /\b([A-Za-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*|_[A-Za-z0-9]+)+)\b/g,
  /(?<![\w/])([\w.-]*(?:\/[\w.-]+)+)/g,
  /\b([A-Za-z_]\w*\(\))/g,
];

const FIGURE_PATTERN = /(?<![\w.])(\d+(?:[.,]\d+)*)(?!\w)/g;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isVersionShaped(figure: string, content: string, index: number): boolean {
  if (figure.includes(".") && figure.split(".").length > 2) return true;
  return /[vV]$/.test(content.slice(Math.max(0, index - 1), index));
}

/**
 * The unit word a figure carries, which is the word directly after it and nothing further. A
 * closing bracket or a clause break ends the phrase: in "messageThreshold (4); cost consent" the
 * figure's unit is not "cost", and pairing across that boundary invents a phrase to demand.
 */
function wordAfter(text: string, index: number): string | null {
  const match = /^[ \t]*([A-Za-z]+)/.exec(text.slice(index));
  return match ? match[1] : null;
}

function codeTokensIn(content: string): string[] {
  const tokens: string[] = [];
  for (const pattern of CODE_TOKEN_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      // A sentence's own punctuation rides along on a path shape, and no path ends in one.
      const token = match[1]?.trim().replace(/[.,;:]+$/, "");
      // A path shape is a path only with an extension or a directory step that reads as one; bare
      // prose slashes ("and/or") would otherwise become specifics the turn has to have quoted.
      if (!token) continue;
      if (token.includes("/") && !token.includes(".") && !token.includes("-")) continue;
      tokens.push(token);
    }
  }
  return [...new Set(tokens)];
}

/**
 * The specifics in a fact that the turn never stated: a code token absent from it, a figure absent
 * from it, or a figure the turn paired with a different unit. That last case is the one the corpus
 * produced twice, so the figure and its unit are checked as a phrase rather than as two tokens.
 */
export function unquotedSpecifics(content: string, turnText: string): string[] {
  const haystack = normalize(turnText);
  const lowerHaystack = haystack.toLowerCase();
  const fact = normalize(content);
  const missing: string[] = [];

  for (const token of codeTokensIn(fact)) {
    // An all-caps acronym is prose, not an identifier: a turn writing `.jsonl` has stated JSONL, and
    // demanding the case makes the check fire on wording rather than on a fact nobody said.
    const isAcronym = /^[A-Z]+$/.test(token);
    const found = isAcronym ? lowerHaystack.includes(token.toLowerCase()) : haystack.includes(token);
    if (!found) missing.push(token);
  }

  for (const match of fact.matchAll(FIGURE_PATTERN)) {
    const figure = match[1];
    const at = match.index ?? 0;
    if (!lowerHaystack.includes(figure.toLowerCase())) {
      missing.push(figure);
      continue;
    }
    if (isVersionShaped(figure, fact, at)) continue;
    const unit = wordAfter(fact, at + figure.length);
    if (!unit || NON_UNIT_WORDS.has(unit.toLowerCase())) continue;
    const pair = `${figure} ${unit}`.toLowerCase();
    if (!lowerHaystack.includes(pair)) missing.push(`${figure} ${unit}`);
  }

  for (const [word] of SPELLED_FIGURES) {
    const pattern = new RegExp(`\\b${word}\\b\\s+([A-Za-z]+)`, "gi");
    for (const match of fact.matchAll(pattern)) {
      const unit = match[1];
      if (NON_UNIT_WORDS.has(unit.toLowerCase())) continue;
      const pair = `${word} ${unit}`.toLowerCase();
      if (!lowerHaystack.includes(pair)) missing.push(`${word} ${unit}`);
    }
  }

  return [...new Set(missing)];
}

const AUXILIARIES: ReadonlySet<string> = new Set([
  "are",
  "be",
  "can",
  "cannot",
  "do",
  "does",
  "had",
  "has",
  "have",
  "is",
  "must",
  "should",
  "stays",
  "was",
  "were",
  "will",
]);

function carriesVerb(segment: string): boolean {
  const words = segment.trim().split(/\s+/);
  if (words.length < 3) return false;
  return words.some((raw) => {
    const word = raw.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (!word) return false;
    if (AUXILIARIES.has(word)) return true;
    return word.length > 4 && (word.endsWith("ed") || word.endsWith("ing") || /[^s]s$/.test(word));
  });
}

/**
 * Whether a fact chains claims instead of making one. One semicolon is ordinary punctuation, so
 * only three or more verb-bearing segments count — the shape the corpus produced when a single
 * record carried an installer, a release, its assets, its draft status and a workflow result.
 */
export function chainedClaims(content: string): boolean {
  const segments = content.split(";").filter((segment) => segment.trim().length > 0);
  if (segments.length < 3) return false;
  return segments.filter(carriesVerb).length >= 3;
}

function toRegExp(literal: string): RegExp {
  const match = /^\/(.*)\/([gimsuy]*)$/.exec(literal);
  if (!match) throw new Error(`mustNot label is not a regex literal: ${literal}`);
  return new RegExp(match[1], match[2]);
}

/** The fixture's own `mustNot` labels that this fact trips, each a failure the corpus measured. */
export function violatedMustNot(content: string, labels: readonly string[]): string[] {
  return labels.filter((label) => toRegExp(label).test(content));
}
