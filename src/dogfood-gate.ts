import { z } from "zod";

type GateArgs = {
  target: number;
  lookback: number;
  minSuccessRate: number;
  minDelegatedSlices: number;
  strictAutonomy: boolean;
  skipVerify: boolean;
  skipSmoke: boolean;
  skipRecovery: boolean;
  skipOneShotDiagnostics: boolean;
  skipSessionDiagnostics: boolean;
  skipConcurrencySafety: boolean;
};

type GateCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

const DEFAULT_TARGET = 10;
const DEFAULT_LOOKBACK = 30;
const DEFAULT_MIN_SUCCESS_RATE = 70;
const DEFAULT_MIN_DELEGATED_SLICES = 6;

const gateArgsSchema = z.object({
  target: z.coerce.number().int().positive(),
  lookback: z.coerce.number().int().positive(),
  minSuccessRate: z.coerce.number().min(0).max(100),
  minDelegatedSlices: z.coerce.number().int().nonnegative(),
  strictAutonomy: z.boolean(),
  skipVerify: z.boolean(),
  skipSmoke: z.boolean(),
  skipRecovery: z.boolean(),
  skipOneShotDiagnostics: z.boolean(),
  skipSessionDiagnostics: z.boolean(),
  skipConcurrencySafety: z.boolean(),
});
const deliveryProgressSchema = z.object({
  deliverySlices: z.number().finite(),
  delegatedSlices: z.number().finite().optional(),
  delegatedSuccess: z.number().finite().optional(),
  delegatedFailure: z.number().finite().optional(),
  delegatedSuccessRate: z.number().finite().optional(),
  target: z.number().finite(),
  percent: z.number().finite(),
  commitsTotal: z.number().finite().optional(),
  commitsScanned: z.number().finite().optional(),
});

function parseArgs(args: string[]): GateArgs {
  const raw: {
    target: number | string;
    lookback: number | string;
    minSuccessRate: number | string;
    minDelegatedSlices: number | string;
    strictAutonomy: boolean;
    skipVerify: boolean;
    skipSmoke: boolean;
    skipRecovery: boolean;
    skipOneShotDiagnostics: boolean;
    skipSessionDiagnostics: boolean;
    skipConcurrencySafety: boolean;
  } = {
    target: DEFAULT_TARGET,
    lookback: DEFAULT_LOOKBACK,
    minSuccessRate: DEFAULT_MIN_SUCCESS_RATE,
    minDelegatedSlices: DEFAULT_MIN_DELEGATED_SLICES,
    strictAutonomy: false,
    skipVerify: false,
    skipSmoke: false,
    skipRecovery: false,
    skipOneShotDiagnostics: false,
    skipSessionDiagnostics: false,
    skipConcurrencySafety: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--target") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Invalid --target value.");
      }
      raw.target = value;
      i += 1;
      continue;
    }
    if (token === "--lookback") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Invalid --lookback value.");
      }
      raw.lookback = value;
      i += 1;
      continue;
    }
    if (token === "--min-success-rate") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Invalid --min-success-rate value.");
      }
      raw.minSuccessRate = value;
      i += 1;
      continue;
    }
    if (token === "--min-delegated-slices") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Invalid --min-delegated-slices value.");
      }
      raw.minDelegatedSlices = value;
      i += 1;
      continue;
    }
    if (token === "--strict-autonomy") {
      raw.strictAutonomy = true;
      continue;
    }
    if (token === "--skip-verify" || token === "--no-verify") {
      raw.skipVerify = true;
      continue;
    }
    if (token === "--skip-smoke" || token === "--no-smoke") {
      raw.skipSmoke = true;
      continue;
    }
    if (token === "--skip-recovery" || token === "--no-recovery") {
      raw.skipRecovery = true;
      continue;
    }
    if (token === "--skip-one-shot-diagnostics" || token === "--no-one-shot-diagnostics") {
      raw.skipOneShotDiagnostics = true;
      continue;
    }
    if (token === "--skip-session-diagnostics" || token === "--no-session-diagnostics") {
      raw.skipSessionDiagnostics = true;
      continue;
    }
    if (token === "--skip-concurrency-safety" || token === "--no-concurrency-safety") {
      raw.skipConcurrencySafety = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  const parsed = gateArgsSchema.safeParse(raw);
  if (!parsed.success) {
    const hasTargetError = parsed.error.issues.some((issue) => issue.path[0] === "target");
    const hasLookbackError = parsed.error.issues.some((issue) => issue.path[0] === "lookback");
    if (hasTargetError) {
      throw new Error("Invalid --target value.");
    }
    if (hasLookbackError) {
      throw new Error("Invalid --lookback value.");
    }
    const hasSuccessRateError = parsed.error.issues.some((issue) => issue.path[0] === "minSuccessRate");
    if (hasSuccessRateError) {
      throw new Error("Invalid --min-success-rate value.");
    }
    const hasDelegatedSlicesError = parsed.error.issues.some((issue) => issue.path[0] === "minDelegatedSlices");
    if (hasDelegatedSlicesError) {
      throw new Error("Invalid --min-delegated-slices value.");
    }
    throw new Error("Invalid arguments.");
  }
  const parsedArgs = parsed.data;
  if (!parsedArgs.strictAutonomy) {
    return parsedArgs;
  }
  return {
    ...parsedArgs,
    minSuccessRate: Math.max(parsedArgs.minSuccessRate, 85),
    minDelegatedSlices: Math.max(parsedArgs.minDelegatedSlices, 10),
  };
}

function run(cmd: string[]): { ok: boolean; stdout: string; stderr: string; code: number } {
  const proc = Bun.spawnSync({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    code: proc.exitCode,
  };
}

function firstNonEmptyLine(value: string): string | null {
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function firstSignalLine(stderr: string, stdout: string): string | null {
  const candidates = [stderr, stdout].flatMap((value) => value.split("\n").map((line) => line.trim()));
  for (const line of candidates) {
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("$ ")) {
      continue;
    }
    if (/^error: script\s+".+"\s+exited with code/i.test(line)) {
      continue;
    }
    return line;
  }
  return null;
}

function parseDeliveryProgress(raw: string): {
  delivery: number;
  target: number;
  percent: number;
  delegatedSuccess?: number;
  delegatedFailure?: number;
  delegatedSuccessRate?: number;
  delegatedSlices?: number;
  commitsTotal?: number;
  commitsScanned?: number;
} | null {
  const candidates = [raw.trim(), ...raw.split("\n").map((line) => line.trim())].filter(
    (line) => line.startsWith("{") && line.endsWith("}"),
  );
  let parsed: unknown;
  let found = false;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate) as unknown;
      found = true;
      break;
    } catch {
      // try next json-looking line
    }
  }
  if (!found) {
    return null;
  }
  const validated = deliveryProgressSchema.safeParse(parsed);
  if (!validated.success) {
    return null;
  }
  return {
    delivery: validated.data.deliverySlices,
    target: validated.data.target,
    percent: validated.data.percent,
    delegatedSuccess: validated.data.delegatedSuccess,
    delegatedFailure: validated.data.delegatedFailure,
    delegatedSuccessRate: validated.data.delegatedSuccessRate,
    delegatedSlices: validated.data.delegatedSlices,
    commitsTotal: validated.data.commitsTotal,
    commitsScanned: validated.data.commitsScanned,
  };
}

function progressDetail(
  result: { ok: boolean; stdout: string; stderr: string },
  parsed: {
    delivery: number;
    target: number;
    percent: number;
    delegatedSuccess?: number;
    delegatedFailure?: number;
    delegatedSuccessRate?: number;
    delegatedSlices?: number;
    commitsTotal?: number;
    commitsScanned?: number;
  } | null,
): string {
  if (result.ok && parsed) {
    const remaining = Math.max(0, parsed.target - parsed.delivery);
    const remainingDetail = `remaining=${remaining}`;
    const delegated =
      parsed.delegatedSuccess !== undefined &&
      parsed.delegatedFailure !== undefined &&
      parsed.delegatedSuccessRate !== undefined
        ? `success=${parsed.delegatedSuccess} failure=${parsed.delegatedFailure} rate=${parsed.delegatedSuccessRate}%`
        : undefined;
    const scoped = parsed.commitsTotal !== undefined ? `scoped=${parsed.commitsTotal}` : undefined;
    const scanned = parsed.commitsScanned !== undefined ? `scanned=${parsed.commitsScanned}` : undefined;
    const extras = [remainingDetail, delegated, scoped, scanned].filter((value): value is string => Boolean(value));
    return extras.length > 0
      ? `${parsed.delivery}/${parsed.target} (${parsed.percent}%, ${extras.join(" ")})`
      : `${parsed.delivery}/${parsed.target} (${parsed.percent}%)`;
  }
  const signal = firstSignalLine(result.stderr, result.stdout);
  return signal ? `unable to parse progress (${signal})` : "unable to parse progress";
}

function summarizeGate(checks: GateCheck[]): { ok: boolean; lines: string[] } {
  const lines = ["Dogfood gate"];
  for (const check of checks) {
    lines.push(`- ${check.ok ? "pass" : "fail"} ${check.name}: ${check.detail}`);
  }
  const ok = checks.every((check) => check.ok);
  lines.push(`- result: ${ok ? "ready" : "not ready"}`);
  return { ok, lines };
}

function printUsage(): void {
  console.log(
    "Usage: bun run dogfood:gate [--lookback N] [--target N] [--min-success-rate N] [--skip-verify|--no-verify] [--skip-smoke|--no-smoke] [--skip-recovery|--no-recovery]",
    "       [--min-delegated-slices N]",
    "       [--strict-autonomy]",
    "       [--skip-one-shot-diagnostics|--no-one-shot-diagnostics]",
    "       [--skip-session-diagnostics|--no-session-diagnostics]",
    "       [--skip-concurrency-safety|--no-concurrency-safety]",
  );
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--help") || argv.includes("-h")) {
      printUsage();
      return;
    }
    const args = parseArgs(argv);
    const checks: GateCheck[] = [];

    if (!args.skipVerify) {
      const verify = run(["bun", "run", "verify"]);
      const verifyError = firstSignalLine(verify.stderr, verify.stdout);
      checks.push({
        name: "verify",
        ok: verify.ok,
        detail: verify.ok ? "green" : `exit ${verify.code}${verifyError ? ` (${verifyError})` : ""}`,
      });
    }

    if (!args.skipSmoke) {
      const smoke = run(["bun", "run", "dogfood:smoke"]);
      const smokeError = firstSignalLine(smoke.stderr, smoke.stdout);
      checks.push({
        name: "smoke",
        ok: smoke.ok,
        detail: smoke.ok ? "green" : `exit ${smoke.code}${smokeError ? ` (${smokeError})` : ""}`,
      });
    }

    if (!args.skipRecovery) {
      const recovery = run(["bun", "test", "src/chat-submit-handler.test.ts"]);
      const recoveryError = firstSignalLine(recovery.stderr, recovery.stdout);
      checks.push({
        name: "recovery",
        ok: recovery.ok,
        detail: recovery.ok ? "green" : `exit ${recovery.code}${recoveryError ? ` (${recoveryError})` : ""}`,
      });
    }

    if (!args.skipOneShotDiagnostics) {
      const diagnostics = run(["bun", "test", "src/cli-run-mode.test.ts", "src/cli.test.ts"]);
      const diagnosticsError = firstSignalLine(diagnostics.stderr, diagnostics.stdout);
      checks.push({
        name: "one-shot-diagnostics",
        ok: diagnostics.ok,
        detail: diagnostics.ok
          ? "green"
          : `exit ${diagnostics.code}${diagnosticsError ? ` (${diagnosticsError})` : ""}`,
      });
    }
    if (!args.skipSessionDiagnostics) {
      const sessionDiagnostics = run(["bun", "test", "src/chat-commands.test.ts"]);
      const sessionDiagnosticsError = firstSignalLine(sessionDiagnostics.stderr, sessionDiagnostics.stdout);
      checks.push({
        name: "session-diagnostics",
        ok: sessionDiagnostics.ok,
        detail: sessionDiagnostics.ok
          ? "green"
          : `exit ${sessionDiagnostics.code}${sessionDiagnosticsError ? ` (${sessionDiagnosticsError})` : ""}`,
      });
    }
    if (!args.skipConcurrencySafety) {
      const concurrency = run(["bun", "test", "src/session-lock.test.ts"]);
      const concurrencyError = firstSignalLine(concurrency.stderr, concurrency.stdout);
      checks.push({
        name: "concurrency-safety",
        ok: concurrency.ok,
        detail: concurrency.ok
          ? "green"
          : `exit ${concurrency.code}${concurrencyError ? ` (${concurrencyError})` : ""}`,
      });
    }

    const progress = run([
      "bun",
      "run",
      "dogfood:progress",
      "--lookback",
      String(args.lookback),
      "--target",
      String(args.target),
      "--json",
    ]);
    const parsedProgress = parseDeliveryProgress(progress.stdout);
    checks.push({
      name: "delivery-slices",
      ok: progress.ok && parsedProgress !== null && parsedProgress.delivery >= args.target,
      detail: progressDetail(progress, parsedProgress),
    });
    checks.push({
      name: "delegated-success-rate",
      ok: progress.ok && parsedProgress !== null && (parsedProgress.delegatedSuccessRate ?? 0) >= args.minSuccessRate,
      detail: parsedProgress
        ? `${parsedProgress.delegatedSuccessRate ?? 0}% (target ${args.minSuccessRate}%)`
        : "missing delegated success-rate signal",
    });
    checks.push({
      name: "delegated-slices",
      ok: progress.ok && parsedProgress !== null && (parsedProgress.delegatedSlices ?? 0) >= args.minDelegatedSlices,
      detail: parsedProgress
        ? `${parsedProgress.delegatedSlices ?? 0} (target ${args.minDelegatedSlices})`
        : "missing delegated slices signal",
    });

    const summary = summarizeGate(checks);
    for (const line of summary.lines) {
      console.log(line);
    }
    if (!summary.ok) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "dogfood gate failed";
    console.error(message);
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}

export { firstNonEmptyLine, parseArgs, parseDeliveryProgress, summarizeGate };
export { firstSignalLine };
export { progressDetail };
