import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const GITHUB_API = "https://api.github.com/repos/cniska/acolyte/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export type UpdateInfo = {
  available: boolean;
  latest: string;
  downloadUrl: string;
};

type CachedCheck = {
  checkedAt: string;
  latest: string;
  downloadUrl: string;
};

type GitHubRelease = {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
};

export function resolveAssetName(): string {
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `acolyte-${platform}-${arch}.tar.gz`;
}

export function compareSemver(current: string, latest: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(current);
  const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(latest);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

function cachePath(homeDir: string): string {
  return join(homeDir, ".acolyte", "update-check.json");
}

async function readCache(homeDir: string): Promise<CachedCheck | null> {
  try {
    const raw = await readFile(cachePath(homeDir), "utf8");
    return JSON.parse(raw) as CachedCheck;
  } catch {
    return null;
  }
}

async function writeCache(homeDir: string, data: CachedCheck): Promise<void> {
  const dir = join(homeDir, ".acolyte");
  await mkdir(dir, { recursive: true });
  await writeFile(cachePath(homeDir), JSON.stringify(data), "utf8");
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const res = await fetch(GITHUB_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "acolyte-cli" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as GitHubRelease;
  } catch {
    return null;
  }
}

export async function checkForUpdate(
  currentVersion: string,
  options?: { force?: boolean; homeDir?: string },
): Promise<UpdateInfo | null> {
  const home = options?.homeDir ?? homedir();
  const force = options?.force ?? false;

  if (!force) {
    const cached = await readCache(home);
    if (cached) {
      const age = Date.now() - new Date(cached.checkedAt).getTime();
      if (age < CHECK_INTERVAL_MS) {
        const available = compareSemver(currentVersion, cached.latest);
        return { available, latest: cached.latest, downloadUrl: cached.downloadUrl };
      }
    }
  }

  const release = await fetchLatestRelease();
  if (!release) return null;

  const version = release.tag_name.replace(/^v/, "");
  const assetName = resolveAssetName();
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) return null;

  await writeCache(home, {
    checkedAt: new Date().toISOString(),
    latest: version,
    downloadUrl: asset.browser_download_url,
  });

  return {
    available: compareSemver(currentVersion, version),
    latest: version,
    downloadUrl: asset.browser_download_url,
  };
}
