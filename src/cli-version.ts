import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function extractVersionFromPackageJsonText(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim().length > 0 ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

export function resolveCliVersion(): string {
  if (process.env.npm_package_version && process.env.npm_package_version.trim().length > 0)
    return process.env.npm_package_version.trim();
  const candidates = [`${process.cwd()}/package.json`, `${import.meta.dir}/../package.json`];
  for (const path of candidates) {
    try {
      const version = extractVersionFromPackageJsonText(readFileSync(path, "utf8"));
      if (version) return version;
    } catch {
      // Try next candidate.
    }
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

function resolveCommitFromGitDir(gitDir: string): string | null {
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref:")) {
      const ref = head.slice("ref:".length).trim();
      const refPath = join(gitDir, ref);
      try {
        return shortCommit(readFileSync(refPath, "utf8"));
      } catch {
        const packed = readFileSync(join(gitDir, "packed-refs"), "utf8");
        const line = packed
          .split("\n")
          .find(
            (value) =>
              value.length > 0 && !value.startsWith("#") && !value.startsWith("^") && value.endsWith(` ${ref}`),
          );
        if (!line) return null;
        const hash = line.split(" ")[0];
        return shortCommit(hash ?? "");
      }
    }
    return shortCommit(head);
  } catch {
    return null;
  }
}

export function resolveCliCommitShort(): string | null {
  const roots = [join(import.meta.dir, "..")];
  for (const root of roots) {
    const gitDir = gitDirFor(root);
    if (!gitDir) continue;
    const commit = resolveCommitFromGitDir(gitDir);
    if (commit) return commit;
  }
  return null;
}

export function formatVersionWithCommit(version: string, commit: string | null): string {
  return commit ? `${version} (${commit})` : version;
}
