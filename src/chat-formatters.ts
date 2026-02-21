import { z } from "zod";

function countLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

const runMetaSchema = z.object({
  exitCode: z.coerce.number().int(),
  durationMs: z.coerce.number().int().nonnegative(),
});

function parseRunMeta(raw: string): { exitCode: number | null; durationMs: number | null } {
  const exitMatch = raw.match(/^exit_code=([^\s]+)$/m);
  const durationMatch = raw.match(/^duration_ms=([^\s]+)$/m);
  const parsed = runMetaSchema.safeParse({
    exitCode: exitMatch?.[1],
    durationMs: durationMatch?.[1],
  });
  if (!parsed.success) {
    return { exitCode: null, durationMs: null };
  }
  return {
    exitCode: parsed.data.exitCode,
    durationMs: parsed.data.durationMs,
  };
}

export function formatThoughtDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatVerifySummary(raw: string): string {
  const meta = parseRunMeta(raw);
  const status = meta.exitCode === 0 ? "passed" : "failed";
  const duration = meta.durationMs === null ? "n/a" : formatThoughtDuration(meta.durationMs);
  return `Verify ${status} (exit ${meta.exitCode ?? "?"}, ${duration}).`;
}

export function formatChangesSummary(statusRaw: string, diffRaw: string): string {
  const statusLines = statusRaw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const branchLine = statusLines.find((line) => line.startsWith("## "));
  const changedFilesFromStatus = statusLines.filter((line) => !line.startsWith("## ")).length;

  let added = 0;
  let removed = 0;
  let changedFilesFromDiff = 0;
  for (const line of diffRaw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      changedFilesFromDiff += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }
  const changedFiles = Math.max(changedFilesFromStatus, changedFilesFromDiff);

  const summary: string[] = [];
  summary.push(
    changedFiles === 0 ? "Working tree clean." : `${countLabel(changedFiles, "changed file", "changed files")}.`,
  );
  if (branchLine) {
    summary.push(branchLine);
  }
  if (changedFiles > 0) {
    summary.push(`Diff summary: +${added} -${removed}.`);
  }
  return summary.join("\n");
}
