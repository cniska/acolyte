import { readdir } from "node:fs/promises";
import { join } from "node:path";

type AtToken = {
  query: string;
  start: number;
  end: number;
};

const MAX_AT_SUGGESTIONS = 8;
const MAX_SCAN_ENTRIES = 5000;
const PATH_CACHE_TTL_MS = 3000;
const IGNORED_DIRS = new Set(["node_modules", ".acolyte", "dist", "build", ".next", "coverage"]);

let repoPathCache: {
  cwd: string;
  loadedAt: number;
  candidates: string[];
} | null = null;

export function invalidateRepoPathCandidates(root?: string): void {
  if (!repoPathCache) return;
  if (!root || repoPathCache.cwd === root) repoPathCache = null;
}

function findActiveAtToken(inputValue: string): AtToken | null {
  const matches = [...inputValue.matchAll(/(^|\s)@([^\s@]*)/g)];
  if (matches.length === 0) return null;
  const match = matches[matches.length - 1];
  const full = match[0] ?? "";
  const query = match[2] ?? "";
  const fullStart = match.index ?? 0;
  const hasLeadingSpace = full.startsWith(" ");
  const start = fullStart + (hasLeadingSpace ? 1 : 0);
  const end = start + full.length - (hasLeadingSpace ? 1 : 0);
  return { query, start, end };
}

export function extractAtReferenceQuery(inputValue: string): string | null {
  return findActiveAtToken(inputValue)?.query ?? null;
}

export function rankAtReferenceSuggestions(paths: string[], query: string, max = MAX_AT_SUGGESTIONS): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths.slice(0, max);

  const querySegments = q.split("/").filter((segment) => segment.length > 0);
  const matchesSegmentPrefixes = (path: string): boolean => {
    if (querySegments.length === 0) return false;
    const pathSegments = path
      .toLowerCase()
      .split("/")
      .filter((segment) => segment.length > 0);
    if (querySegments.length > pathSegments.length) return false;
    return querySegments.every((segment, index) => (pathSegments[index] ?? "").startsWith(segment));
  };
  const isSubsequence = (path: string): boolean => {
    let qi = 0;
    const lower = path.toLowerCase();
    for (let i = 0; i < lower.length && qi < q.length; i += 1) {
      if (lower[i] === q[qi]) qi += 1;
    }
    return qi === q.length;
  };
  const basenameStartsWith = (path: string): boolean => {
    const slash = path.lastIndexOf("/");
    const basename = (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
    return basename.startsWith(q);
  };
  const score = (path: string): number => {
    const lower = path.toLowerCase();
    if (lower.startsWith(q)) return 0;
    if (basenameStartsWith(path)) return 1;
    if (matchesSegmentPrefixes(path)) return 2;
    if (lower.includes(q)) return 3;
    if (isSubsequence(path)) return 4;
    return 5;
  };

  return paths
    .map((path) => ({ path, score: score(path) }))
    .filter((item) => item.score < 5)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.path.length !== b.path.length) return a.path.length - b.path.length;
      return a.path.localeCompare(b.path);
    })
    .map((item) => item.path)
    .slice(0, max);
}

export function shouldAutocompleteAtSubmit(inputValue: string, selectedSuggestion: string | undefined): boolean {
  if (!selectedSuggestion) return false;
  const token = findActiveAtToken(inputValue);
  if (!token) return false;
  const currentToken = inputValue.slice(token.start, token.end);
  if (!currentToken.startsWith("@")) return false;
  return currentToken !== `@${selectedSuggestion}`;
}

export function applyAtSuggestion(inputValue: string, suggestion: string): string {
  const token = findActiveAtToken(inputValue);
  if (!token) return inputValue;
  const before = inputValue.slice(0, token.start);
  const after = inputValue.slice(token.end);
  const spacedAfter = after.startsWith(" ") ? after : after.length === 0 ? " " : ` ${after}`;
  return `${before}@${suggestion}${spacedAfter}`;
}

export function extractAtReferencePaths(inputValue: string): string[] {
  const matches = [...inputValue.matchAll(/(^|\s)@([^\s@]+)/g)];
  if (matches.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of matches) {
    const raw = match[2] ?? "";
    const cleaned = raw.replace(/[.,;:!?]+$/g, "").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

async function collectRepoPathCandidates(root = process.cwd(), maxEntries = MAX_SCAN_ENTRIES): Promise<string[]> {
  const out: string[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: "" }];

  while (stack.length > 0 && out.length < maxEntries) {
    const current = stack.pop();
    if (!current) break;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const abs = join(current.abs, entry.name);
      if (entry.isDirectory()) {
        if (rel === ".git") {
          out.push(".git/config");
          out.push(".git/COMMIT_EDITMSG");
          continue;
        }
        out.push(`${rel}/`);
        stack.push({ abs, rel });
      } else if (entry.isFile()) {
        out.push(rel);
      }
      if (out.length >= maxEntries) break;
    }
  }

  return out;
}

export async function getCachedRepoPathCandidates(root = process.cwd()): Promise<string[]> {
  const now = Date.now();
  if (repoPathCache && repoPathCache.cwd === root && now - repoPathCache.loadedAt < PATH_CACHE_TTL_MS)
    return repoPathCache.candidates;
  const candidates = await collectRepoPathCandidates(root);
  repoPathCache = {
    cwd: root,
    loadedAt: now,
    candidates,
  };
  return candidates;
}
