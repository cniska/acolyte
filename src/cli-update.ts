import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stdout } from "node:process";
import { compareVersions, resolveCliVersion, UNVERSIONED_CLI_VERSION } from "./cli-version";
import { stateDir } from "./paths";
import { ansi } from "./tui/styles";
import { dimText, printDim, printError, printWarning } from "./ui";
import { stageUpdate } from "./update-ops";
import { isVersionStaged, pruneStagedVersions } from "./update-staging";

const GITHUB_API = "https://api.github.com/repos/cniska/acolyte/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

type UpdateInfo = { available: boolean; latest: string; downloadUrl: string; checksumUrl: string | null };
type CachedCheck = { checkedAt: string; latest: string; downloadUrl: string; checksumUrl?: string };
type GitHubRelease = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

export function resolveAssetName(): string {
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `acolyte-${platform}-${arch}.tar.gz`;
}

function cachePath(baseDir: string): string {
  return join(baseDir, "update-check.json");
}

async function readCache(baseDir: string): Promise<CachedCheck | null> {
  try {
    const raw = await readFile(cachePath(baseDir), "utf8");
    return JSON.parse(raw) as CachedCheck;
  } catch {
    return null;
  }
}

async function writeCache(baseDir: string, data: CachedCheck): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  await writeFile(cachePath(baseDir), JSON.stringify(data), "utf8");
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

async function checkForUpdate(
  currentVersion: string,
  options?: { force?: boolean; stateDir?: string },
): Promise<UpdateInfo | null> {
  const home = options?.stateDir ?? stateDir();
  const force = options?.force ?? false;

  if (!force) {
    const cached = await readCache(home);
    if (cached) {
      const age = Date.now() - new Date(cached.checkedAt).getTime();
      if (age < CHECK_INTERVAL_MS) {
        const available = compareVersions(cached.latest, currentVersion) > 0;
        return {
          available,
          latest: cached.latest,
          downloadUrl: cached.downloadUrl,
          checksumUrl: cached.checksumUrl ?? null,
        };
      }
    }
  }

  const release = await fetchLatestRelease();
  if (!release) return null;

  const version = release.tag_name.replace(/^v/, "");
  const assetName = resolveAssetName();
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) return null;
  const checksumAsset = release.assets.find((a) => a.name === `${assetName.replace(/\.tar\.gz$/, "")}.sha256`);

  await writeCache(home, {
    checkedAt: new Date().toISOString(),
    latest: version,
    downloadUrl: asset.browser_download_url,
    checksumUrl: checksumAsset?.browser_download_url,
  });

  return {
    available: compareVersions(version, currentVersion) > 0,
    latest: version,
    downloadUrl: asset.browser_download_url,
    checksumUrl: checksumAsset?.browser_download_url ?? null,
  };
}

const BAR_FILL = "\u2588";
const BAR_EMPTY = "\u2591";

function progressBar(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  return `${BAR_FILL.repeat(filled)}${BAR_EMPTY.repeat(width - filled)}`;
}

function progressLine(fraction: number): string {
  const percent = Math.round(fraction * 100);
  return dimText(`Downloading  ${progressBar(fraction, 20)}  ${String(percent).padStart(3)}%`);
}

function renderHeader(current: string, latest: string): void {
  stdout.write(ansi.cursorHide);
  printDim(`Acolyte v${current} \u2192 v${latest}`);
  stdout.write(`${progressLine(0)}\n`);
}

function renderProgress(received: number, total: number): void {
  const fraction = total > 0 ? Math.min(received / total, 1) : 0;
  stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
  stdout.write(`${progressLine(fraction)}\n`);
}

function renderDone(latest: string): void {
  stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
  printDim(`Staged v${latest}. It runs the next time you start Acolyte.`);
  stdout.write(`\n${ansi.cursorShow}`);
}

function renderError(message: string): void {
  stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
  printError(`Update failed: ${message}`);
  stdout.write(ansi.cursorShow);
}

export async function updateMode(): Promise<void> {
  const currentVersion = resolveCliVersion();
  const update = await checkForUpdate(currentVersion, { force: true });

  if (!update) {
    printWarning("Could not check for updates. Check your network connection.");
    return;
  }

  if (!update.available) {
    printDim(`Already up to date (${currentVersion}).`);
    return;
  }

  renderHeader(currentVersion, update.latest);
  const result = await stageUpdate(update.downloadUrl, update.checksumUrl, update.latest, renderProgress);
  if (!result.success) {
    renderError(result.error ?? "unknown error");
    return;
  }
  renderDone(update.latest);
}

/**
 * Stages a newer release without announcing it: the launcher picks it up on the next start, so an
 * update never interrupts the session that fetched it. Never throws — a start must not fail here.
 */
export async function stageUpdateOnStartup(options?: { skip?: boolean }): Promise<void> {
  if (options?.skip) return;
  if (process.env.ACOLYTE_SKIP_UPDATE === "1") return;
  if (process.argv.includes("--no-update")) return;

  const currentVersion = resolveCliVersion();
  if (currentVersion === UNVERSIONED_CLI_VERSION) return;

  try {
    await pruneStagedVersions(currentVersion);
    const update = await checkForUpdate(currentVersion);
    if (!update?.available) return;
    if (await isVersionStaged(update.latest)) return;

    // A failure needs no bookkeeping: the day-cache still names this release, so the next start
    // reads it and tries again without asking GitHub a second time.
    await stageUpdate(update.downloadUrl, update.checksumUrl, update.latest);
  } catch {
    // A start must not fail over an update it was not asked for.
  }
}
