const DEFAULT_TARGET = 10;
const DEFAULT_LOOKBACK = 30;

type Commit = {
  hash: string;
  subject: string;
  date: string;
};

type ProgressArgs = {
  since?: string;
  target: number;
  lookback: number;
};

function parseArgs(args: string[]): ProgressArgs {
  const parsed: ProgressArgs = {
    target: DEFAULT_TARGET,
    lookback: DEFAULT_LOOKBACK,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--since") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --since.");
      }
      parsed.since = value;
      i += 1;
      continue;
    }
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
    throw new Error(`Unknown argument: ${token}`);
  }

  return parsed;
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
    const type = commit.subject.match(/^([a-z]+)(?:\(|:)/i)?.[1]?.toLowerCase() ?? "other";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function runGitLog(args: ProgressArgs): Commit[] {
  const cmd = [
    "git log --date=short --pretty=format:%h%x09%ad%x09%s",
    args.since ? `--since='${args.since.replaceAll("'", "'\"'\"'")}'` : `-n ${args.lookback}`,
  ].join(" ");
  const proc = Bun.spawnSync({
    cmd: ["bash", "-lc", cmd],
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
  const total = commits.length;
  const pct = Math.min(100, Math.round((total / args.target) * 100));
  const remaining = Math.max(0, args.target - total);
  const scope = args.since ? `since ${args.since}` : `last ${args.lookback} commits`;
  const types = summarizeByType(commits);

  console.log("Dogfood progress");
  console.log(`- scope: ${scope}`);
  console.log(`- slices: ${total}/${args.target} (${pct}%)`);
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

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
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

export { parseArgs, parseGitLog, summarizeByType };
