import { ensurePathWithinAllowedRoots, runCommand } from "./tool-utils";

export async function gitStatusShort(workspace: string): Promise<string> {
  const { code, stdout, stderr } = await runCommand(["git", "status", "--short"], workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git status failed");
  return stdout.trim();
}

export async function gitDiff(workspace: string, pathInput?: string, contextLines = 3): Promise<string> {
  const args = ["git", "diff", `--unified=${contextLines}`];
  if (pathInput) {
    ensurePathWithinAllowedRoots(pathInput, "Diff", workspace);
    args.push("--", pathInput);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git diff failed");
  return stdout.trim();
}

export async function gitLog(workspace: string, options?: { path?: string; limit?: number }): Promise<string> {
  const limit = Math.max(1, Math.min(50, options?.limit ?? 10));
  const args = ["git", "log", "--oneline", "--decorate", `-n`, String(limit)];
  if (options?.path) {
    ensurePathWithinAllowedRoots(options.path, "Log", workspace);
    args.push("--", options.path);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git log failed");
  return stdout.trim();
}

export async function gitShow(
  workspace: string,
  options?: { ref?: string; path?: string; contextLines?: number },
): Promise<string> {
  const contextLines = Math.max(0, Math.min(20, options?.contextLines ?? 3));
  const ref = options?.ref?.trim() ? options.ref.trim() : "HEAD";
  const args = ["git", "show", "--no-color", `--unified=${contextLines}`, ref];
  if (options?.path) {
    ensurePathWithinAllowedRoots(options.path, "Show", workspace);
    args.push("--", options.path);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git show failed");
  return stdout.trim();
}

export async function gitAdd(workspace: string, options?: { paths?: string[]; all?: boolean }): Promise<string> {
  const all = options?.all === true;
  const paths = (options?.paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  if (!all && paths.length === 0) throw new Error("git add requires at least one path when all=false");
  if (all && paths.length > 0) throw new Error("git add cannot combine all=true with explicit paths");
  for (const pathInput of paths) ensurePathWithinAllowedRoots(pathInput, "Add", workspace);
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
