import { access, chmod, copyFile, lstat, mkdir, readdir, rename, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FETCH_TIMEOUT_MS = 5_000;

export type ProgressCallback = (received: number, total: number) => void;
export type InstallResult = { success: boolean; error?: string };

export async function downloadToFile(url: string, dest: string, onProgress?: ProgressCallback): Promise<void> {
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

export async function validateArchiveEntries(tarPath: string): Promise<void> {
  const proc = Bun.spawn(["tar", "tzf", tarPath], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`Failed to list archive entries (exit ${exitCode})`);
  for (const entry of stdout.split("\n").filter(Boolean)) {
    const segments = entry.split("/");
    if (segments.some((s) => s === "..") || entry.startsWith("/")) {
      throw new Error(`Unsafe archive entry: ${entry}`);
    }
  }
}

export async function extractBinary(tarPath: string, outDir: string): Promise<string> {
  await validateArchiveEntries(tarPath);
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
  const stat = await lstat(binaryPath);
  if (!stat.isFile()) throw new Error("Extracted acolyte is not a regular file");
  const entries = await readdir(outDir);
  const unexpected = entries.filter((e) => e !== "acolyte");
  if (unexpected.length > 0) throw new Error(`Unexpected files in archive: ${unexpected.join(", ")}`);
  return binaryPath;
}

export function parseChecksumFile(content: string): string {
  const expected = content.trim().split(/\s+/)[0];
  if (!expected) throw new Error("Checksum file is empty or malformed");
  return expected;
}

export async function computeFileChecksum(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const file = Bun.file(filePath);
  const stream = file.stream();
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

export async function verifyChecksum(filePath: string, checksumUrl: string): Promise<void> {
  const res = await fetch(checksumUrl, {
    headers: { "user-agent": "acolyte-cli" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Checksum fetch failed: ${res.status}`);
  const expected = parseChecksumFile(await res.text());
  const actual = await computeFileChecksum(filePath);
  if (expected !== actual) {
    throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

export async function installUpdate(
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
