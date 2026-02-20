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

function findActiveAtToken(inputValue: string): AtToken | null {
  const matches = [...inputValue.matchAll(/(^|\s)@([^\s@]*)/g)];
  if (matches.length === 0) {
    return null;
  }
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
  if (!q) {
    return paths.slice(0, max);
  }
  return paths
    .filter((path) => path.toLowerCase().includes(q))
    .sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aStarts = aLower.startsWith(q) ? 0 : 1;
      const bStarts = bLower.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }
      if (a.length !== b.length) {
        return a.length - b.length;
      }
      return a.localeCompare(b);
    })
    .slice(0, max);
}

export function shouldAutocompleteAtSubmit(inputValue: string, selectedSuggestion: string | undefined): boolean {
  if (!selectedSuggestion) {
    return false;
  }
  const token = findActiveAtToken(inputValue);
  if (!token) {
    return false;
  }
  const currentToken = inputValue.slice(token.start, token.end);
  if (!currentToken.startsWith("@")) {
    return false;
  }
  return currentToken !== `@${selectedSuggestion}`;
}

export function applyAtSuggestion(inputValue: string, suggestion: string): string {
  const token = findActiveAtToken(inputValue);
  if (!token) {
    return inputValue;
  }
  const before = inputValue.slice(0, token.start);
  const after = inputValue.slice(token.end);
  const spacedAfter = after.startsWith(" ") || after.length === 0 ? after : ` ${after}`;
  return `${before}@${suggestion}${spacedAfter}`;
}

export function extractAtReferencePaths(inputValue: string): string[] {
  const matches = [...inputValue.matchAll(/(^|\s)@([^\s@]+)/g)];
  if (matches.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of matches) {
    const raw = match[2] ?? "";
    const cleaned = raw.replace(/[.,;:!?]+$/g, "").trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
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
    if (!current) {
      break;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }
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
      if (out.length >= maxEntries) {
        break;
      }
    }
  }

  return out;
}

export async function getCachedRepoPathCandidates(root = process.cwd()): Promise<string[]> {
  const now = Date.now();
  if (repoPathCache && repoPathCache.cwd === root && now - repoPathCache.loadedAt < PATH_CACHE_TTL_MS) {
    return repoPathCache.candidates;
  }
  const candidates = await collectRepoPathCandidates(root);
  repoPathCache = {
    cwd: root,
    loadedAt: now,
    candidates,
  };
  return candidates;
}
