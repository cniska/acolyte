import { z } from "zod";

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

const gateArgsSchema = z.object({
  target: z.coerce.number().int().positive(),
  lookback: z.coerce.number().int().positive(),
  skipVerify: z.boolean(),
  skipSmoke: z.boolean(),
});
const deliveryProgressSchema = z.object({
  deliverySlices: z.number().finite(),
  target: z.number().finite(),
  percent: z.number().finite(),
});

function parseArgs(args: string[]): GateArgs {
  const raw: { target: number | string; lookback: number | string; skipVerify: boolean; skipSmoke: boolean } = {
    target: DEFAULT_TARGET,
    lookback: DEFAULT_LOOKBACK,
    skipVerify: false,
    skipSmoke: false,
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
    if (token === "--skip-verify") {
      raw.skipVerify = true;
      continue;
    }
    if (token === "--skip-smoke") {
      raw.skipSmoke = true;
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
    throw new Error("Invalid arguments.");
  }
  return parsed.data;
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

function parseDeliveryProgress(raw: string): { delivery: number; target: number; percent: number } | null {
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
