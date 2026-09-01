import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// The directory holding the shared config: `.git` in a primary checkout, and in a linked worktree
// the git dir named by the `.git` file, whose `commondir` points back at the checkout it belongs to.
function gitCommonDir(repoRoot: string): string | null {
  const gitPath = join(repoRoot, ".git");
  let entry: ReturnType<typeof statSync>;
  try {
    entry = statSync(gitPath);
  } catch {
    return null;
  }
  if (entry.isDirectory()) return gitPath;

  const gitdir = readFileSync(gitPath, "utf8")
    .match(/^gitdir:\s*(.+)$/m)?.[1]
    ?.trim();
  if (!gitdir) return null;
  const linkedGitDir = resolve(repoRoot, gitdir);
  try {
    return resolve(linkedGitDir, readFileSync(join(linkedGitDir, "commondir"), "utf8").trim());
  } catch {
    return linkedGitDir;
  }
}

function readOriginUrl(configPath: string): string | null {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return null;
  }

  let inOrigin = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const url = line.match(/^url\s*=\s*(.+)$/)?.[1]?.trim();
    if (url) return url;
  }
  return null;
}

/**
 * Reduces a remote URL to the `owner/repo` that names the repository, however it is addressed. The
 * host is excluded, so a repository keeps its identity when it moves between forges.
 */
export function repositoryLabel(url: string): string | null {
  const trimmed = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(trimmed)?.[0];
  const addressed = trimmed.slice(scheme?.length ?? 0).replace(/^[^/@]*@/, "");
  // A path names a directory on one machine, not a repository other checkouts can share.
  if (addressed.startsWith("/")) return null;

  // `host:path` addresses the same repository as `ssh://host/path`. Only the URL form can carry a
  // port, so in the shorthand a leading number is the first path segment and has to survive.
  const rooted = scheme ? addressed.replace(/^([^/:]+)(:\d+)?/, "$1") : addressed.replace(/^([^/:]+):/, "$1/");
  const [host, ...ownerAndName] = rooted
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (!host || ownerAndName.length < 2) return null;
  return ownerAndName.join("/").toLowerCase();
}

/** The `owner/repo` a checkout's `origin` names, or null when it has none to share. */
export function originRepositoryLabel(repoRoot: string): string | null {
  const commonDir = gitCommonDir(repoRoot);
  if (!commonDir) return null;
  const url = readOriginUrl(join(commonDir, "config"));
  return url ? repositoryLabel(url) : null;
}
