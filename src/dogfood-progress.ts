import { z } from "zod";

const DEFAULT_TARGET = 10;
const DEFAULT_LOOKBACK = 30;
const DELIVERY_TYPES = new Set(["feat", "fix", "refactor", "test"]);
const NON_DELIVERY_EXCLUDED_TYPES = new Set(["docs"]);

type Commit = {
  hash: string;
  subject: string;
  date: string;
};

type ProgressArgs = {
  since?: string;
  target: number;
  lookback: number;
  json: boolean;
};

const progressArgsSchema = z.object({
  since: z.string().min(1).optional(),
  target: z.coerce.number().int().positive(),
  lookback: z.coerce.number().int().positive(),
  json: z.boolean(),
});

function parseArgs(args: string[]): ProgressArgs {
  const raw: { since?: string; target: number | string; lookback: number | string; json: boolean } = {
    target: DEFAULT_TARGET,
    lookback: DEFAULT_LOOKBACK,
    json: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--since") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --since.");
      }
      raw.since = value;
      i += 1;
      continue;
    }
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
    if (token === "--json") {
      raw.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  const parsed = progressArgsSchema.safeParse(raw);
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

function parseGitLog(raw: string): Commit[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash, date, ...subjectParts] = line.split("\t");
      return {
        hash: hash ?? "",
        date: date ?? "",
        subject: subjectParts.join("\t"),
      };
    })
    .filter((row) => row.hash.length > 0 && row.subject.length > 0);
}

function summarizeByType(commits: Commit[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    const type = commitType(commit.subject);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function countDeliverySlices(types: Array<{ type: string; count: number }>): number {
  return types.reduce((sum, row) => sum + (DELIVERY_TYPES.has(row.type) ? row.count : 0), 0);
}

function countDelegatedOutcomes(commits: Commit[]): { success: number; failure: number; successRate: number } {
  let success = 0;
  let failure = 0;
  for (const commit of commits) {
    if (DELIVERY_TYPES.has(commitType(commit.subject))) {
      success += 1;
    } else {
      failure += 1;
    }
  }
  const total = success + failure;
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  return { success, failure, successRate };
}

function commitType(subject: string): string {
  return subject.match(/^([a-z]+)(?:\(|:)/i)?.[1]?.toLowerCase() ?? "other";
}

function selectScopeCommits(commits: Commit[], args: ProgressArgs): Commit[] {
  if (args.since) {
    return commits;
  }
  const scoped: Commit[] = [];
  for (const commit of commits) {
    if (NON_DELIVERY_EXCLUDED_TYPES.has(commitType(commit.subject))) {
      continue;
    }
    scoped.push(commit);
    if (scoped.length >= args.lookback) {
      break;
    }
  }
  return scoped;
}

function buildGitLogCmd(args: ProgressArgs): string[] {
  const base = ["git", "log", "--date=short", "--pretty=format:%h%x09%ad%x09%s"];
  if (args.since) {
    return [...base, "--since", args.since];
  }
  return [...base, "-n", String(args.lookback)];
}

function runGitLog(args: ProgressArgs): Commit[] {
  const proc = Bun.spawnSync({
    cmd: buildGitLogCmd(args),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const error = proc.stderr.toString().trim() || "git log failed";
    throw new Error(error);
  }
  return parseGitLog(proc.stdout.toString());
}

function printProgress(commits: Commit[], args: ProgressArgs): void {
  const scopedCommits = selectScopeCommits(commits, args);
  const total = scopedCommits.length;
  const scope = args.since ? `since ${args.since}` : `last ${args.lookback} non-doc commits`;
  const types = summarizeByType(scopedCommits);
  const delivery = countDeliverySlices(types);
  const delegated = countDelegatedOutcomes(scopedCommits);
  const pct = Math.min(100, Math.round((delivery / args.target) * 100));
  const remaining = Math.max(0, args.target - delivery);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          scope,
          commitsTotal: total,
          commitsScanned: commits.length,
          deliverySlices: delivery,
          delegatedSuccess: delegated.success,
          delegatedFailure: delegated.failure,
          delegatedSuccessRate: delegated.successRate,
          target: args.target,
          percent: pct,
          remaining,
          commitTypes: types,
          hint:
            total === 0 && args.since ? "no commits matched --since; try --lookback 30 or adjust the date." : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("Dogfood progress");
  console.log(`- scope: ${scope}`);
  console.log(`- commits (scoped): ${total}`);
  if (!args.since) {
    console.log(`- commits scanned: ${commits.length}`);
  }
  console.log(`- slices (delivery): ${delivery}/${args.target} (${pct}%)`);
  console.log(
    `- delegated outcomes (proxy): success=${delegated.success} failure=${delegated.failure} rate=${delegated.successRate}%`,
  );
  console.log(`- remaining to target: ${remaining}`);
  if (types.length > 0) {
    console.log("- commit types:");
    for (const row of types) {
      console.log(`  - ${row.type}: ${row.count}`);
    }
  }
  if (total === 0 && args.since) {
    console.log("- hint: no commits matched --since; try --lookback 30 or adjust the date.");
  }
}

function printUsage(): void {
  console.log("Usage: bun run dogfood:progress [--since YYYY-MM-DD] [--lookback N] [--target N] [--json]");
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--help") || argv.includes("-h")) {
      printUsage();
      return;
    }
    const args = parseArgs(argv);
    const commits = runGitLog(args);
    printProgress(commits, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute progress.";
    console.error(message);
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}

export { buildGitLogCmd, countDeliverySlices, parseArgs, parseGitLog, summarizeByType };
export { commitType, countDelegatedOutcomes, selectScopeCommits };
