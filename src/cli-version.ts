import { readFileSync } from "node:fs";

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
