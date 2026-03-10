export function normalizePath(p: string): string {
  const trimmed = p.endsWith("/") ? p.replace(/\/+$/, "") : p;
  return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

export function extractReadPaths(args: Record<string, unknown>, opts?: { normalize?: boolean }): string[] {
  const paths = args.paths;
  if (!Array.isArray(paths)) return [];
  const shouldNormalize = opts?.normalize ?? false;
  const out: string[] = [];
  for (const entry of paths) {
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path === "string" && path.trim().length > 0) {
      out.push(shouldNormalize ? normalizePath(path.trim()) : path.trim());
    }
  }
  return out;
}

export function extractSearchPatterns(args: Record<string, unknown>): string[] {
  const normalize = (value: string): string => {
    const trimmed = value.trim().toLowerCase();
    const boundaryMatch = trimmed.match(/^\\b(.+)\\b$/);
    const core = boundaryMatch?.[1]?.trim() ?? trimmed;
    return core.replace(/^["'`](.+)["'`]$/, "$1");
  };
  const patterns = new Set<string>();
  const single = args.pattern;
  if (typeof single === "string" && single.trim().length > 0) patterns.add(normalize(single));
  const multi = args.patterns;
  if (Array.isArray(multi)) {
    for (const entry of multi) {
      if (typeof entry !== "string") continue;
      const trimmed = normalize(entry);
      if (trimmed.length > 0) patterns.add(trimmed);
    }
  }
  return Array.from(patterns).sort();
}

export function extractSearchScope(args: Record<string, unknown>): string[] {
  const raw = args.paths;
  if (!Array.isArray(raw) || raw.length === 0) return ["__workspace__"];
  const scope = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = normalizePath(entry.trim().toLowerCase());
    if (trimmed.length > 0) scope.add(trimmed);
  }
  if (scope.size === 0) return ["__workspace__"];
  return Array.from(scope).sort();
}

export function extractFindPatterns(args: Record<string, unknown>): string[] {
  const patterns = args.patterns;
  if (!Array.isArray(patterns)) return [];
  const normalized = new Set<string>();
  for (const entry of patterns) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().toLowerCase();
    if (trimmed.length > 0) normalized.add(trimmed);
  }
  return Array.from(normalized).sort();
}

export function includesUniversalFindPattern(patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    return trimmed === "*" || trimmed === "**/*";
  });
}
