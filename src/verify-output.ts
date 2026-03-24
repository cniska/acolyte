import { relative } from "node:path";

const CONTEXT_LINES = 2;
const FALLBACK_MAX_LINES = 200;

export function filterOutputByPaths(output: string, changedPaths: string[], workspace: string): string {
  if (!output.trim()) return "";
  if (changedPaths.length === 0) return output;

  const relativePaths = changedPaths
    .map((p) => relative(workspace, p))
    .filter((p) => p.length > 0 && !p.startsWith(".."));

  if (relativePaths.length === 0) return output;

  const lines = output.split("\n");
  const matchedIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (relativePaths.some((p) => line.includes(p))) {
      for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) {
        matchedIndices.add(j);
      }
    }
  }

  if (matchedIndices.size === 0) {
    return lines.slice(0, FALLBACK_MAX_LINES).join("\n");
  }

  const sorted = Array.from(matchedIndices).sort((a, b) => a - b);
  return sorted.map((i) => lines[i]).join("\n");
}
