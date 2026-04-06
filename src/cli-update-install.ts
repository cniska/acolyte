import { chmod, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ProgressCallback = (received: number, total: number) => void;

export type InstallResult = {
  success: boolean;
  error?: string;
};

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
  return join(outDir, "acolyte");
}

export async function installUpdate(downloadUrl: string, onProgress?: ProgressCallback): Promise<InstallResult> {
  const binaryPath = process.execPath;
  const tmpDir = tmpdir();
  const tarPath = join(tmpDir, `acolyte-update-${Date.now()}.tar.gz`);
  const extractDir = join(tmpDir, `acolyte-extract-${Date.now()}`);
  const newBinaryPath = `${binaryPath}.new`;

  try {
    await downloadToFile(downloadUrl, tarPath, onProgress);

    await Bun.spawn(["mkdir", "-p", extractDir]).exited;
    const extractedPath = await extractBinary(tarPath, extractDir);

    await Bun.spawn(["cp", extractedPath, newBinaryPath]).exited;
    await chmod(newBinaryPath, 0o755);
    await rename(newBinaryPath, binaryPath);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Clean up partial download/extract on failure
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
      await Bun.spawn(["rm", "-rf", extractDir]).exited;
    } catch {
      // ignore
    }
  }
}
