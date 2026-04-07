import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { normalizePath } from "./tool-arg-paths";
import { ensurePathWithinSandbox } from "./workspace-sandbox";

export type UndoCheckpointEntry = {
  id: string;
  seq: number;
  toolCallId: string;
  toolId: string;
  paths: string[];
  createdAt: string;
};

type UndoCheckpointFile = {
  path: string;
  beforeExists: boolean;
  afterExists: boolean;
  beforeHash?: string;
  afterHash?: string;
};

type UndoCheckpointMeta = UndoCheckpointEntry & {
  files: UndoCheckpointFile[];
};

function sha256Hex(value: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

function ensureSafeRelPath(workspace: string, pathInput: string): string {
  const abs = ensurePathWithinSandbox(pathInput, workspace);
  const rel = relative(workspace, abs).replace(/\\/g, "/");
  const normalized = normalizePath(rel);
  if (!normalized || normalized.startsWith("..")) throw new Error(`Invalid path outside workspace: ${pathInput}`);
  return normalized;
}

function undoBaseDir(workspace: string, sessionId: string): string {
  return join(workspace, ".acolyte", "undo", sessionId);
}

function checkpointsDir(workspace: string, sessionId: string): string {
  return join(undoBaseDir(workspace, sessionId), "checkpoints");
}

function formatCheckpointDirName(seq: number, toolCallId: string): string {
  const padded = String(seq).padStart(6, "0");
  return `${padded}_${toolCallId}`;
}

async function readMaybe(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

async function nextSequence(dir: string): Promise<number> {
  if (!existsSync(dir)) return 1;
  const entries = await readdir(dir, { withFileTypes: true });
  let max = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(/^(\d{6})_/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export type PendingUndoCapture = {
  toolCallId: string;
  toolId: string;
  paths: string[];
  before: Map<string, Uint8Array | null>;
};

const DEFAULT_MAX_CHECKPOINTS = 50;

export async function captureUndoBefore(options: {
  workspace: string;
  toolCallId: string;
  toolId: string;
  paths: string[];
}): Promise<PendingUndoCapture> {
  const before = new Map<string, Uint8Array | null>();
  for (const p of options.paths) {
    const rel = ensureSafeRelPath(options.workspace, p);
    const abs = resolve(options.workspace, rel);
    before.set(rel, await readMaybe(abs));
  }
  return { toolCallId: options.toolCallId, toolId: options.toolId, paths: Array.from(before.keys()), before };
}

export async function commitUndoCheckpoint(options: {
  workspace: string;
  sessionId: string;
  pending: PendingUndoCapture;
  maxCheckpoints?: number;
}): Promise<UndoCheckpointEntry> {
  const dir = checkpointsDir(options.workspace, options.sessionId);
  const seq = await nextSequence(dir);
  const id = `cp_${String(seq).padStart(6, "0")}`;
  const createdAt = new Date().toISOString();
  const checkpointName = formatCheckpointDirName(seq, options.pending.toolCallId);
  const checkpointDir = join(dir, checkpointName);
  const beforeDir = join(checkpointDir, "before");
  const afterDir = join(checkpointDir, "after");

  const files: UndoCheckpointFile[] = [];
  for (const rel of options.pending.paths) {
    const abs = resolve(options.workspace, rel);
    const beforeBytes = options.pending.before.get(rel) ?? null;
    const afterBytes = await readMaybe(abs);

    const beforeExists = beforeBytes !== null;
    const afterExists = afterBytes !== null;
    const record: UndoCheckpointFile = { path: rel, beforeExists, afterExists };
    if (beforeBytes) record.beforeHash = sha256Hex(beforeBytes);
    if (afterBytes) record.afterHash = sha256Hex(afterBytes);
    files.push(record);

    if (beforeBytes) {
      const target = join(beforeDir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, beforeBytes);
    }
    if (afterBytes) {
      const target = join(afterDir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, afterBytes);
    }
  }

  const entry: UndoCheckpointEntry = {
    id,
    seq,
    toolCallId: options.pending.toolCallId,
    toolId: options.pending.toolId,
    paths: options.pending.paths,
    createdAt,
  };
  const meta: UndoCheckpointMeta = { ...entry, files };

  await mkdir(checkpointDir, { recursive: true });
  await writeAtomic(join(checkpointDir, "meta.json"), JSON.stringify(meta, null, 2));

  const max = options.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
  if (Number.isFinite(max) && max > 0) {
    try {
      await pruneOldCheckpoints(dir, max);
    } catch {
      // Non-fatal.
    }
  }
  return entry;
}

async function pruneOldCheckpoints(dir: string, max: number): Promise<void> {
  if (!existsSync(dir)) return;
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^\d{6}_/.test(name))
    .sort();
  if (dirs.length <= max) return;
  const toRemove = dirs.slice(0, Math.max(0, dirs.length - max));
  for (const name of toRemove) {
    await rm(join(dir, name), { recursive: true, force: true });
  }
}

export async function listUndoCheckpoints(options: {
  workspace: string;
  sessionId: string;
  limit?: number;
}): Promise<UndoCheckpointEntry[]> {
  const dir = checkpointsDir(options.workspace, options.sessionId);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^\d{6}_/.test(name))
    .sort()
    .reverse();
  const out: UndoCheckpointEntry[] = [];
  for (const name of dirs) {
    if (options.limit && out.length >= options.limit) break;
    const metaPath = join(dir, name, "meta.json");
    try {
      const raw = await readFile(metaPath, "utf8");
      const parsed = JSON.parse(raw) as UndoCheckpointMeta;
      out.push({
        id: parsed.id,
        seq: parsed.seq,
        toolCallId: parsed.toolCallId,
        toolId: parsed.toolId,
        paths: parsed.paths,
        createdAt: parsed.createdAt,
      });
    } catch {
      // Ignore corrupt checkpoints.
    }
  }
  return out;
}

async function resolveCheckpointDir(
  workspace: string,
  sessionId: string,
  checkpointId: string,
): Promise<string | null> {
  const dir = checkpointsDir(workspace, sessionId);
  if (!existsSync(dir)) return null;
  const m = checkpointId.match(/^cp_(\d{6})$/);
  if (!m) return null;
  const prefix = `${m[1]}_`;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(prefix)) return join(dir, entry.name);
  }
  return null;
}

export type UndoRestoreResult = {
  restored: string[];
  conflicts: Array<{ path: string; reason: "changed" | "missing_after_snapshot" }>;
};

export async function restoreUndoCheckpoint(options: {
  workspace: string;
  sessionId: string;
  checkpointId: string;
  paths: string[];
}): Promise<UndoRestoreResult> {
  const checkpointDir = await resolveCheckpointDir(options.workspace, options.sessionId, options.checkpointId);
  if (!checkpointDir) throw new Error(`Checkpoint not found: ${options.checkpointId}`);

  const rawMeta = await readFile(join(checkpointDir, "meta.json"), "utf8");
  const meta = JSON.parse(rawMeta) as UndoCheckpointMeta;
  const wanted = new Set(options.paths.map((p) => ensureSafeRelPath(options.workspace, p)));

  const beforeDir = join(checkpointDir, "before");
  const afterDir = join(checkpointDir, "after");
  const conflicts: UndoRestoreResult["conflicts"] = [];

  for (const file of meta.files) {
    if (!wanted.has(file.path)) continue;

    // Verify current workspace state matches the snapshot we are undoing from.
    const abs = resolve(options.workspace, file.path);
    const current = await readMaybe(abs);
    const afterPath = join(afterDir, file.path);
    const afterBytes = file.afterExists ? await readMaybe(afterPath) : null;
    if (file.afterExists && afterBytes === null) {
      conflicts.push({ path: file.path, reason: "missing_after_snapshot" });
      continue;
    }
    const currentHash = current ? sha256Hex(current) : null;
    const afterHash = afterBytes ? sha256Hex(afterBytes) : null;
    if ((currentHash ?? null) !== (afterHash ?? null)) {
      conflicts.push({ path: file.path, reason: "changed" });
    }
  }

  if (conflicts.length > 0) return { restored: [], conflicts };

  const restored: string[] = [];
  for (const file of meta.files) {
    if (!wanted.has(file.path)) continue;
    const abs = resolve(options.workspace, file.path);
    if (!file.beforeExists) {
      await rm(abs, { force: true });
      restored.push(file.path);
      continue;
    }
    const beforeBytes = await readFile(join(beforeDir, file.path));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, beforeBytes);
    restored.push(file.path);
  }

  return { restored, conflicts: [] };
}

export async function isFilePath(workspace: string, pathInput: string): Promise<boolean> {
  try {
    const abs = ensurePathWithinSandbox(pathInput, workspace);
    const s = await stat(abs);
    return s.isFile();
  } catch {
    return false;
  }
}
