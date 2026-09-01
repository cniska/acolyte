import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { dataDir } from "./paths";
import { createId } from "./short-id";
import { runCommand } from "./tool-utils";
import { resolveProjectRoot } from "./workspace-sandbox";

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export type WorkspaceName = z.infer<typeof workspaceNameSchema>;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function suggestWorkspaceName(prompt: string): WorkspaceName {
  const base = slugify(prompt).slice(0, 40);
  const candidate = base.length > 0 ? base : `ws-${createId()}`;
  const parsed = workspaceNameSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return workspaceNameSchema.parse(`ws-${createId()}`);
}

export async function resolveGitRepoRoot(cwd = process.cwd()): Promise<string> {
  const { code, stdout, stderr } = await runCommand(["git", "rev-parse", "--show-toplevel"], cwd);
  if (code !== 0) throw new Error(stderr.trim() || "git rev-parse failed");
  const root = stdout.trim();
  if (root.length === 0) throw new Error("git rev-parse returned empty repo root");
  return root;
}

// Worktrees belong to a checkout, not to the repository it clones: two checkouts of one repository on
// this machine own separate worktrees, so this directory is named for the path rather than the remote.
function checkoutStorageKey(workspace: string): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(resolveProjectRoot(workspace));
  return hasher.digest("hex").slice(0, 12);
}

export function projectWorktreesDir(workspace: string): string {
  return join(dataDir(), "projects", checkoutStorageKey(workspace), "worktrees");
}

export async function createGitWorktree(options: {
  repoRoot: string;
  name: WorkspaceName;
  baseRef?: string;
}): Promise<{ workspacePath: string; branch: string }> {
  const baseRef = options.baseRef?.trim().length ? options.baseRef.trim() : "HEAD";
  const baseDir = projectWorktreesDir(options.repoRoot);
  await mkdir(baseDir, { recursive: true });
  const workspacePath = join(baseDir, options.name);
  const branch = `acolyte-ws/${options.name}`;
  const { code, stdout, stderr } = await runCommand(
    ["git", "worktree", "add", "-b", branch, workspacePath, baseRef],
    options.repoRoot,
  );
  if (code !== 0) {
    const message = stderr.trim() || stdout.trim() || "git worktree add failed";
    throw new Error(message);
  }
  return { workspacePath, branch };
}
