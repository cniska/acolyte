function parseRunMeta(raw: string): { exitCode: number | null; durationMs: number | null } {
  const exitMatch = raw.match(/^exit_code=(\d+)$/m);
  const durationMatch = raw.match(/^duration_ms=(\d+)$/m);
  return {
    exitCode: exitMatch ? Number.parseInt(exitMatch[1], 10) : null,
    durationMs: durationMatch ? Number.parseInt(durationMatch[1], 10) : null,
  };
}

function countLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
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

export function formatDogfoodStatus(input: {
  backendStatus: string;
  verifySummary: string;
  hasApiKey: boolean;
}): string {
  const keyStatus = input.hasApiKey ? "set" : "missing";
  const verifyOk = /\bpassed\b/i.test(input.verifySummary);
  const backendOk = !/\b(unavailable|failed|error)\b/i.test(input.backendStatus);
  const switchGate = verifyOk && backendOk && input.hasApiKey ? "ready" : "not ready yet";
  const lines = [
    "Dogfood status",
    `- ${input.verifySummary}`,
    `- Backend: ${input.backendStatus}`,
    `- OPENAI_API_KEY: ${keyStatus}`,
    `- Switch gate: ${switchGate}`,
  ];
  return lines.join("\n");
}

export function formatChangesSummary(statusRaw: string, diffRaw: string): string {
  const statusLines = statusRaw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const branchLine = statusLines.find((line) => line.startsWith("## "));
  const changedFiles = statusLines.filter((line) => !line.startsWith("## ")).length;

  let added = 0;
  let removed = 0;
  for (const line of diffRaw.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }

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
