import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ZERO = "0".repeat(40);
export const REAL_IDENTITY = { name: "Real Name", email: "real@example.xn--p1ai" };
export const PLACEHOLDER_IDENTITY = { name: "Your Name", email: "real@example.dev" };

const REPO = process.cwd();
const COMMIT_SCRIPTS = ["check-commits.sh", "check-commit-message.sh", "check-commit-author.sh"];

export type Identity = { name: string; email: string };

/** A throwaway repository for exercising the commit checks. */
export type GitFixture = {
  readonly dir: string;
  git(args: string[]): Promise<void>;
  gitOutput(args: string[]): string;
  commit(subject: string, author: Identity, committer?: Identity): Promise<void>;
  /** Environment with every GIT_* key dropped — an inherited GIT_DIR would point at the real repo. */
  env(overrides?: Record<string, string>): Record<string, string>;
  cleanup(): Promise<void>;
};

export async function createGitFixture(options: { prefix: string; hook?: boolean } = { prefix: "acolyte-git-" }) {
  const dir = await mkdtemp(join(tmpdir(), options.prefix));

  const env = (overrides: Record<string, string> = {}): Record<string, string> => {
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))) as Record<
      string,
      string
    >;
    return { ...base, ...overrides };
  };

  const git = async (args: string[], cwd = dir): Promise<void> => {
    const proc = Bun.spawn(["git", ...args], { cwd, env: env(), stdout: "pipe", stderr: "pipe" });
    if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`);
  };

  const gitOutput = (args: string[]): string =>
    Bun.spawnSync(["git", ...args], { cwd: dir, env: env() })
      .stdout.toString()
      .trim();

  const commit = async (subject: string, author: Identity, committer = author): Promise<void> => {
    await Bun.write(join(dir, `file-${Date.now()}-${Math.random()}.txt`), "x");
    await git(["add", "-A"]);
    await git([
      "-c",
      `user.name=${committer.name}`,
      "-c",
      `user.email=${committer.email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      subject,
      `--author=${author.name} <${author.email}>`,
      "--no-verify",
    ]);
  };

  await git(["init", "-q", "-b", "main"]);
  await mkdir(join(dir, "scripts"));
  for (const script of COMMIT_SCRIPTS) {
    await cp(join(REPO, "scripts", script), join(dir, "scripts", script));
  }
  if (options.hook) {
    await mkdir(join(dir, ".githooks"));
    await mkdir(join(dir, "bin"));
    // A stub `bun` keeps the hook's trailing `bun run verify` from running the real suite.
    await Bun.write(join(dir, "bin", "bun"), "#!/bin/sh\nexit 0\n");
    await Bun.spawnSync(["chmod", "755", join(dir, "bin", "bun")]);
    await cp(join(REPO, ".githooks/pre-push"), join(dir, ".githooks/pre-push"));
  }

  const fixture: GitFixture = {
    dir,
    git: (args) => git(args),
    gitOutput,
    commit,
    env,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
  return fixture;
}
