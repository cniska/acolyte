import { access, chmod, copyFile, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdout } from "node:process";
import { resolveCliVersion } from "./cli-version";
import { resolveHomeDir } from "./home-dir";
import { palette } from "./palette";
import { stopAllLocalServers } from "./server-daemon";
import { ansi, colorToFg } from "./tui/styles";
import { printOutput } from "./ui";

const GITHUB_API = "https://api.github.com/repos/cniska/acolyte/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

type UpdateInfo = { available: boolean; latest: string; downloadUrl: string; checksumUrl: string | null };
type CachedCheck = { checkedAt: string; latest: string; downloadUrl: string; checksumUrl?: string };
type GitHubRelease = { tag_name: string; assets: { name: string; browser_download_url: string }[] };
type InstallResult = { success: boolean; error?: string };

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

async function checkForUpdate(
  currentVersion: string,
  options?: { force?: boolean; homeDir?: string },
): Promise<UpdateInfo | null> {
  const home = options?.homeDir ?? resolveHomeDir();
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

type ProgressCallback = (received: number, total: number) => void;

async function downloadToFile(url: string, dest: string, onProgress?: ProgressCallback): Promise<void> {
  const res = await fetch(url, {
    headers: { "user-agent": "acolyte-cli" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;

  const file = Bun.file(dest);
  const writer = file.writer();

  for await (const chunk of res.body) {
    writer.write(chunk);
    received += chunk.byteLength;
    if (onProgress && total > 0) onProgress(received, total);
  }

  await writer.end();
}

async function extractBinary(tarPath: string, outDir: string): Promise<string> {
  const proc = Bun.spawn(["tar", "xzf", tarPath, "-C", outDir], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Extract failed (exit ${exitCode}): ${stderr}`);
  }
  const binaryPath = join(outDir, "acolyte");
  await access(binaryPath);
  const entries = await readdir(outDir);
  const unexpected = entries.filter((e) => e !== "acolyte");
  if (unexpected.length > 0) throw new Error(`Unexpected files in archive: ${unexpected.join(", ")}`);
  return binaryPath;
}

async function verifyChecksum(filePath: string, checksumUrl: string): Promise<void> {
  const res = await fetch(checksumUrl, {
    headers: { "user-agent": "acolyte-cli" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Checksum fetch failed: ${res.status}`);
  const expected = (await res.text()).trim().split(/\s+/)[0];
  if (!expected) throw new Error("Checksum file is empty or malformed");

  const hasher = new Bun.CryptoHasher("sha256");
  const file = Bun.file(filePath);
  const stream = file.stream();
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  const actual = hasher.digest("hex");

  if (expected !== actual) {
    throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

async function installUpdate(
  downloadUrl: string,
  checksumUrl: string | null,
  onProgress?: ProgressCallback,
): Promise<InstallResult> {
  const binaryPath = process.execPath;
  const tmp = tmpdir();
  const tarPath = join(tmp, `acolyte-update-${Date.now()}.tar.gz`);
  const extractDir = join(tmp, `acolyte-extract-${Date.now()}`);
  const newBinaryPath = `${binaryPath}.new`;

  try {
    await downloadToFile(downloadUrl, tarPath, onProgress);
    if (checksumUrl) await verifyChecksum(tarPath, checksumUrl);

    await mkdir(extractDir, { recursive: true });
    const extractedPath = await extractBinary(tarPath, extractDir);

    await copyFile(extractedPath, newBinaryPath);
    await chmod(newBinaryPath, 0o755);
    await rename(newBinaryPath, binaryPath);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await unlink(newBinaryPath);
    } catch {
      // ignore
    }
    return { success: false, error: message };
  } finally {
    try {
      await unlink(tarPath);
    } catch {
      // ignore
    }
    try {
      await rm(extractDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

const BRAND = colorToFg(palette.brand);
const GREEN = colorToFg(palette.green);
const RED = colorToFg(palette.red);
const BAR_FILL = "\u2588";
const BAR_EMPTY = "\u2591";

function progressBar(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  const empty = width - filled;
  return `${BRAND}${BAR_FILL.repeat(filled)}${ansi.dim}${BAR_EMPTY.repeat(empty)}${ansi.reset}`;
}

function renderHeader(current: string, latest: string): void {
  stdout.write(ansi.cursorHide);
  stdout.write(
    `\n  ${BRAND}Acolyte${ansi.reset} ${ansi.dim}v${current}${ansi.reset} \u2192 ${ansi.dim}v${latest}${ansi.reset}\n\n`,
  );
  stdout.write(`  Downloading  ${progressBar(0, 20)}   0%\n`);
}

function renderProgress(received: number, total: number): void {
  const fraction = total > 0 ? Math.min(received / total, 1) : 0;
  const percent = Math.round(fraction * 100);
  stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
  stdout.write(`  Downloading  ${progressBar(fraction, 20)}  ${String(percent).padStart(3)}%\n`);
}

function renderDone(latest: string): void {
  stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
  stdout.write(`  ${GREEN}Updated to v${latest}${ansi.reset}\n\n`);
  stdout.write(ansi.cursorShow);
}

function renderError(message: string): void {
  stdout.write(`${ansi.cursorUp(1)}${ansi.eraseLine}`);
  stdout.write(`  ${RED}Update failed: ${message}${ansi.reset}\n\n`);
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

export async function updateMode(): Promise<void> {
  const currentVersion = resolveCliVersion();
  const update = await checkForUpdate(currentVersion, { force: true });

  if (!update) {
    printOutput("Could not check for updates. Check your network connection.");
    return;
  }

  if (!update.available) {
    printOutput(`Already up to date (${currentVersion}).`);
    return;
  }

  await performUpdate(currentVersion, update);
}

export const cliUpdateInternals = { verifyChecksum };

export async function checkAndUpdateOnStartup(options?: { skip?: boolean }): Promise<boolean> {
  if (options?.skip) return false;
  if (process.env.ACOLYTE_SKIP_UPDATE === "1") return false;
  if (process.argv.includes("--no-update")) return false;

  const currentVersion = resolveCliVersion();
  if (currentVersion === "dev") return false;

  const update = await checkForUpdate(currentVersion);
  if (!update?.available) return false;

  await performUpdate(currentVersion, update);
  return true;
}
