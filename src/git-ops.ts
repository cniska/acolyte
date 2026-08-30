import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { createToolError } from "./tool-error";
import { runCommand } from "./tool-utils";
import { ensurePathWithinSandbox } from "./workspace-sandbox";

const MIN_GIT_VERSION = [2, 14] as const;

// A user's own git config can rewrite diff output — `diff.noprefix` drops the a/ b/ prefixes,
// `diff.external` replaces the engine outright — so anything Acolyte parses or renders has to
// read from a config the user cannot reach. `envWithoutGitState` only unsets these keys, which
// restores git's default of reading ~/.gitconfig; neutralizing them means setting them.
export function hermeticGitEnv(overrides?: Record<string, string>): Record<string, string> {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    ...overrides,
  };
}

let gitVersion: string | null = null;

function canonicalPathForGit(pathInput: string): string {
  const missingSegments: string[] = [];
  let current = pathInput;
  while (!existsSync(current)) {
    missingSegments.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return join(realpathSync(current), ...missingSegments);
}

function gitUnavailable(message: string) {
  return createToolError(TOOL_ERROR_CODES.gitUnavailable, message, ERROR_KINDS.gitUnavailable);
}

async function readGitVersion(): Promise<string> {
  // Spawning a name that is not on PATH throws rather than returning a status, so the missing-git
  // case reaches here as ENOENT and has to be named before it escapes as an unclassified error.
  const probe = await runCommand(["git", "--version"], process.cwd(), hermeticGitEnv()).catch(() => null);
  const version = probe?.stdout.trim() ?? "";
  const parsed = version.match(/(\d+)\.(\d+)/);
  if (probe === null || probe.code !== 0 || !parsed) {
    throw gitUnavailable("The git executable is required and is not available on PATH. Install git 2.14 or newer.");
  }
  const [major, minor] = [Number(parsed[1]), Number(parsed[2])];
  if (major < MIN_GIT_VERSION[0] || (major === MIN_GIT_VERSION[0] && minor < MIN_GIT_VERSION[1])) {
    throw gitUnavailable(`The git executable is ${major}.${minor}; 2.14 or newer is required. Upgrade git.`);
  }
  return version;
}

export async function requireGitVersion(): Promise<string> {
  if (gitVersion) return gitVersion;
  gitVersion = await readGitVersion();
  return gitVersion;
}

export async function gitStatusShort(workspace: string): Promise<string> {
  const { code, stdout, stderr } = await runCommand(["git", "status", "--short"], workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git status failed");
  return stdout.trim();
}

export async function gitDiff(workspace: string, pathInput?: string, contextLines = 3): Promise<string> {
  const args = ["git", "diff", `--unified=${contextLines}`];
  if (pathInput) {
    ensurePathWithinSandbox(pathInput, workspace);
    args.push("--", pathInput);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace, hermeticGitEnv());
  if (code !== 0) throw new Error(stderr.trim() || "git diff failed");
  return stdout.trim();
}

export async function gitLog(
  workspace: string,
  options?: { path?: string; limit?: number },
  envOverride?: Record<string, string>,
): Promise<string> {
  const limit = Math.max(1, Math.min(50, options?.limit ?? 10));
  const args = ["git", "log", "--oneline", "--decorate", `-n`, String(limit)];
  if (options?.path) {
    ensurePathWithinSandbox(options.path, workspace);
    args.push("--", options.path);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace, envOverride);
  if (code !== 0) throw new Error(stderr.trim() || "git log failed");
  return stdout.trim();
}

export async function gitShow(
  workspace: string,
  options?: { ref?: string; path?: string; contextLines?: number },
  envOverride?: Record<string, string>,
): Promise<string> {
  const contextLines = Math.max(0, Math.min(20, options?.contextLines ?? 3));
  const ref = options?.ref?.trim() ? options.ref.trim() : "HEAD";
  let args = ["git", "show", "--no-color", `--unified=${contextLines}`, ref];
  if (options?.path) {
    const absolutePath = ensurePathWithinSandbox(options.path, workspace);
    const topLevel = await runCommand(["git", "rev-parse", "--show-toplevel"], workspace, envOverride);
    if (topLevel.code !== 0) throw new Error(topLevel.stderr.trim() || "git rev-parse failed");
    const repoPath = relative(canonicalPathForGit(topLevel.stdout.trim()), canonicalPathForGit(absolutePath));
    args = ["git", "show", "--no-color", `${ref}:${repoPath}`];
  }
  const { code, stdout, stderr } = await runCommand(args, workspace, envOverride);
  if (code !== 0) throw new Error(stderr.trim() || "git show failed");
  return stdout.trim();
}

export async function gitAdd(workspace: string, options?: { paths?: string[]; all?: boolean }): Promise<string> {
  const all = options?.all === true;
  const paths = (options?.paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  if (!all && paths.length === 0) throw new Error("git add requires at least one path when all=false");
  if (all && paths.length > 0) throw new Error("git add cannot combine all=true with explicit paths");
  for (const pathInput of paths) ensurePathWithinSandbox(pathInput, workspace);
  const args = ["git", "add", ...(all ? ["-A"] : ["--", ...paths])];
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git add failed");
  const out = stdout.trim();
  return out.length > 0 ? out : "staged";
}

export async function gitCommit(workspace: string, options: { message: string; body?: string[] }): Promise<string> {
  const subject = options.message.trim();
  if (subject.length === 0) throw new Error("git commit message cannot be empty");
  const body = (options.body ?? []).map((line) => line.trim()).filter((line) => line.length > 0);
  const args = ["git", "commit", "-m", subject];
  for (const line of body) args.push("-m", line);
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || "git commit failed");
  const out = stdout.trim();
  return out.length > 0 ? out : "committed";
}
