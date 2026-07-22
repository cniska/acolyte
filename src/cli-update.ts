import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stdout } from "node:process";
import { resolveCliVersion } from "./cli-version";
import { stateDir } from "./paths";
import { stopAllLocalServers } from "./server-daemon";
import { ansi } from "./tui/styles";
import { dimText, printDim, printError, printWarning } from "./ui";
import { installUpdate, isSelfUpdatableBinary } from "./update-ops";

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
        const available = compareSemver(currentVersion, cached.latest);
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
    available: compareSemver(currentVersion, version),
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
  printDim(`Updated to v${latest}`);
  stdout.write(`\n${ansi.cursorShow}`);
}

function renderError(message: string): void {
  stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
  printError(`Update failed: ${message}`);
  stdout.write(ansi.cursorShow);
}

function reexec(): never {
  const result = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(result.exitCode ?? 1);
}

async function performUpdate(currentVersion: string, update: UpdateInfo): Promise<void> {
  renderHeader(currentVersion, update.latest);

  const result = await installUpdate(update.downloadUrl, update.checksumUrl, (received, total) => {
    renderProgress(received, total);
  });

  if (!result.success) {
    renderError(result.error ?? "unknown error");
    return;
  }

  renderDone(update.latest);
  await stopAllLocalServers();
  reexec();
}

export async function updateMode(execPath: string = process.execPath): Promise<void> {
  if (!isSelfUpdatableBinary(execPath)) {
    printDim(
      "Self-update applies only to the installed acolyte binary. Running from source; update via your package manager or a fresh install.",
    );
    return;
  }
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

  await performUpdate(currentVersion, update);
}

export async function checkAndUpdateOnStartup(options?: { skip?: boolean }): Promise<boolean> {
  if (options?.skip) return false;
  if (process.env.ACOLYTE_SKIP_UPDATE === "1") return false;
  if (process.argv.includes("--no-update")) return false;
  if (!isSelfUpdatableBinary()) return false;

  const currentVersion = resolveCliVersion();
  const update = await checkForUpdate(currentVersion);
  if (!update?.available) return false;

  await performUpdate(currentVersion, update);
  return true;
}
