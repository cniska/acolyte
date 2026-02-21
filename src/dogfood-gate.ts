type GateArgs = {
  target: number;
  lookback: number;
  skipVerify: boolean;
  skipSmoke: boolean;
};

type GateCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

const DEFAULT_TARGET = 10;
const DEFAULT_LOOKBACK = 30;

function parseArgs(args: string[]): GateArgs {
  const parsed: GateArgs = {
    target: DEFAULT_TARGET,
    lookback: DEFAULT_LOOKBACK,
    skipVerify: false,
    skipSmoke: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--target") {
      const value = Number.parseInt(args[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Invalid --target value.");
      }
      parsed.target = value;
      i += 1;
      continue;
    }
    if (token === "--lookback") {
      const value = Number.parseInt(args[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Invalid --lookback value.");
      }
      parsed.lookback = value;
      i += 1;
      continue;
    }
    if (token === "--skip-verify") {
      parsed.skipVerify = true;
      continue;
    }
    if (token === "--skip-smoke") {
      parsed.skipSmoke = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return parsed;
}

function run(command: string): { ok: boolean; stdout: string; stderr: string; code: number } {
  const proc = Bun.spawnSync({
    cmd: ["bash", "-lc", command],
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

function parseDeliveryProgress(raw: string): { delivery: number; target: number; percent: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const obj = parsed as { deliverySlices?: unknown; target?: unknown; percent?: unknown };
  if (
    typeof obj.deliverySlices !== "number" ||
    !Number.isFinite(obj.deliverySlices) ||
    typeof obj.target !== "number" ||
    !Number.isFinite(obj.target) ||
    typeof obj.percent !== "number" ||
    !Number.isFinite(obj.percent)
  ) {
    return null;
  }
  return {
    delivery: obj.deliverySlices,
    target: obj.target,
    percent: obj.percent,
  };
}

function progressDetail(
  result: { ok: boolean; stdout: string; stderr: string },
  parsed: { delivery: number; target: number; percent: number } | null,
): string {
  if (result.ok && parsed) {
    return `${parsed.delivery}/${parsed.target} (${parsed.percent}%)`;
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

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const checks: GateCheck[] = [];

    if (!args.skipVerify) {
      const verify = run("bun run verify");
      const verifyError = firstSignalLine(verify.stderr, verify.stdout);
      checks.push({
        name: "verify",
        ok: verify.ok,
        detail: verify.ok ? "green" : `exit ${verify.code}${verifyError ? ` (${verifyError})` : ""}`,
      });
    }

    if (!args.skipSmoke) {
      const smoke = run("bun run dogfood:smoke:env");
      const smokeError = firstSignalLine(smoke.stderr, smoke.stdout);
      checks.push({
        name: "smoke",
        ok: smoke.ok,
        detail: smoke.ok ? "green" : `exit ${smoke.code}${smokeError ? ` (${smokeError})` : ""}`,
      });
    }

    const progress = run(`bun run dogfood:progress --lookback ${args.lookback} --target ${args.target} --json`);
    const parsedProgress = parseDeliveryProgress(progress.stdout);
    checks.push({
      name: "delivery-slices",
      ok: progress.ok && parsedProgress !== null && parsedProgress.delivery >= args.target,
      detail: progressDetail(progress, parsedProgress),
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
