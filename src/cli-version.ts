import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { field } from "./field";

export function extractVersionFromPackageJsonText(text: string): string | null {
  try {
    const version = field(JSON.parse(text), "version");
    return typeof version === "string" && version.trim().length > 0 ? version.trim() : null;
  } catch {
    return null;
  }
}

export function resolveCliVersion(): string {
  const compiled = process.env.ACOLYTE_COMPILED_VERSION;
  if (compiled && compiled.trim().length > 0) return compiled.trim();
  // Only this install's own manifest can answer: the working directory and npm_package_version
  // both describe the user's project, so reading them reports the workspace's version as ours.
  try {
    const version = extractVersionFromPackageJsonText(readFileSync(`${import.meta.dir}/../package.json`, "utf8"));
    if (version) return version;
  } catch {
    // Fall through to the unknown-version marker.
  }
  return "dev";
}

function shortCommit(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return null;
  return trimmed.slice(0, 7).toLowerCase();
}

function gitDirFor(repoRoot: string): string | null {
  try {
    const gitPath = join(repoRoot, ".git");
    if (!existsSync(gitPath)) return null;
    const stat = lstatSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    const text = readFileSync(gitPath, "utf8").trim();
    if (!text.startsWith("gitdir:")) return null;
    const target = text.slice("gitdir:".length).trim();
    return target.startsWith("/") ? target : join(repoRoot, target);
  } catch {
    return null;
  }
}

/** A linked worktree's git dir holds only HEAD and its own index; refs live in the main git dir,
 *  which `commondir` points at. Git resolves refs through that pointer, so this must too. */
function refSearchDirs(gitDir: string): string[] {
  try {
    const commonDir = readFileSync(join(gitDir, "commondir"), "utf8").trim();
    if (!commonDir) return [gitDir];
    return [gitDir, commonDir.startsWith("/") ? commonDir : join(gitDir, commonDir)];
  } catch {
    return [gitDir];
  }
}

function resolveRef(gitDir: string, ref: string): string | null {
  for (const dir of refSearchDirs(gitDir)) {
    try {
      const commit = shortCommit(readFileSync(join(dir, ref), "utf8"));
      if (commit) return commit;
    } catch {
      // Loose ref absent here; try this dir's packed refs, then the next dir.
    }
    try {
      const line = readFileSync(join(dir, "packed-refs"), "utf8")
        .split("\n")
        .find(
          (value) => value.length > 0 && !value.startsWith("#") && !value.startsWith("^") && value.endsWith(` ${ref}`),
        );
      if (line) return shortCommit(line.split(" ")[0] ?? "");
    } catch {
      // No packed refs here either.
    }
  }
  return null;
}

function resolveCommitFromGitDir(gitDir: string): string | null {
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref:")) return resolveRef(gitDir, head.slice("ref:".length).trim());
    return shortCommit(head);
  } catch {
    return null;
  }
}

export function resolveCommitShortFor(root: string): string | null {
  const gitDir = gitDirFor(root);
  return gitDir ? resolveCommitFromGitDir(gitDir) : null;
}

export function resolveCliCommitShort(): string | null {
  return resolveCommitShortFor(join(import.meta.dir, ".."));
}

export function formatVersionWithCommit(version: string, commit: string | null): string {
  return commit ? `${version} (${commit})` : version;
}
