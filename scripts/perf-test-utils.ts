export const PERF_COMMAND_TIMEOUT_MS = 180_000;

export type TimedCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export async function runTimedCommand(
  cmd: string[],
  env: Record<string, string>,
  timeoutMs = PERF_COMMAND_TIMEOUT_MS,
  cwd?: string,
): Promise<TimedCommandResult> {
  const startedAt = performance.now();
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env,
    cwd,
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const completed = Promise.all([stdoutPromise, stderrPromise, proc.exited]).then(([stdout, stderr, exitCode]) => ({
    exitCode,
    stdout,
    stderr,
    durationMs: performance.now() - startedAt,
  }));

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<TimedCommandResult>((resolve) => {
    timeoutId = setTimeout(async () => {
      proc.kill();
      const [stdout, stderr] = await Promise.all([stdoutPromise.catch(() => ""), stderrPromise.catch(() => "")]);
      resolve({
        exitCode: 124,
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`,
        durationMs: performance.now() - startedAt,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([completed, timedOut]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const middle = sorted[mid];
  if (sorted.length % 2 === 0) {
    if (lower === undefined || middle === undefined) return 0;
    return (lower + middle) / 2;
  }
  return middle ?? 0;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
