import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { normalizePath } from "./tool-arg-paths";
import type { PostToolContext, PreToolContext, SessionContext } from "./tool-session";
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
  beforeStored: boolean;
  afterStored: boolean;
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

const UNDO_CHECKPOINT_MAX_CONTENT_BYTES = 256_000;
const UNDO_CHECKPOINT_MAX_HASH_BYTES = 5_000_000;

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

async function statMaybe(path: string): Promise<{ size: number } | null> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    return { size: s.size };
  } catch {
    return null;
  }
}

async function hashMaybeCapped(path: string, maxBytes: number): Promise<{ hash: string; size: number } | null> {
  const s = await statMaybe(path);
  if (!s) return null;
  if (s.size > maxBytes) return null;
  const bytes = await readFile(path);
  return { hash: sha256Hex(bytes), size: s.size };
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
  before: Map<
    string,
    {
      beforeExists: boolean;
      beforeStored: boolean;
      beforeBytes?: Uint8Array;
      beforeHash?: string;
    }
  >;
};

function collectUndoPathsFromToolArgs(
  toolId: string,
  args: Record<string, unknown>,
): { paths: string[]; needsFileCheck: boolean } {
  const paths: string[] = [];
  let needsFileCheck = false;
  if (toolId === "file-edit" || toolId === "file-create") {
    const p = typeof args.path === "string" ? args.path.trim() : "";
    if (p) paths.push(p);
  } else if (toolId === "file-delete") {
    const ps = args.paths;
    if (Array.isArray(ps)) {
      for (const p of ps) if (typeof p === "string" && p.trim().length > 0) paths.push(p.trim());
    }
  } else if (toolId === "code-edit") {
    const p = typeof args.path === "string" ? args.path.trim() : "";
    if (p) {
      paths.push(p);
      needsFileCheck = true;
    }
  }
  return { paths, needsFileCheck };
}

export function attachUndoCheckpointSideEffects(options: {
  workspace: string;
  sessionId: string;
  session: SessionContext;
  writeToolSet: ReadonlySet<string>;
}): void {
  const pendingUndo = new Map<string, PendingUndoCapture>();

  const prevBeforeAsync = options.session.onBeforeToolAsync;
  options.session.onBeforeToolAsync = async (preCtx: PreToolContext) => {
    await prevBeforeAsync?.(preCtx);
    if (!options.writeToolSet.has(preCtx.toolId)) return;

    const { paths, needsFileCheck } = collectUndoPathsFromToolArgs(preCtx.toolId, preCtx.args);
    if (paths.length === 0) return;

    if (needsFileCheck) {
      const filtered: string[] = [];
      for (const p of paths) {
        if (await isFilePath(options.workspace, p)) filtered.push(p);
      }
      if (filtered.length === 0) return;
      paths.splice(0, paths.length, ...filtered);
    }

    const capture = await captureUndoBefore({
      workspace: options.workspace,
      toolCallId: preCtx.toolCallId,
      toolId: preCtx.toolId,
      paths,
    });
    pendingUndo.set(preCtx.toolCallId, capture);
  };

  const prevAfterAsync = options.session.onAfterToolAsync;
  options.session.onAfterToolAsync = async (postCtx: PostToolContext) => {
    await prevAfterAsync?.(postCtx);
    if (!options.writeToolSet.has(postCtx.toolId)) return;

    const pending = pendingUndo.get(postCtx.toolCallId);
    if (!pending) return;
    pendingUndo.delete(postCtx.toolCallId);
    if (postCtx.status !== "succeeded") return;
    await commitUndoCheckpoint({ workspace: options.workspace, sessionId: options.sessionId, pending });
  };
}

const DEFAULT_MAX_CHECKPOINTS = 50;

export async function captureUndoBefore(options: {
  workspace: string;
  toolCallId: string;
  toolId: string;
  paths: string[];
}): Promise<PendingUndoCapture> {
  const before = new Map<
    string,
    { beforeExists: boolean; beforeStored: boolean; beforeBytes?: Uint8Array; beforeHash?: string }
  >();
  for (const p of options.paths) {
    const rel = ensureSafeRelPath(options.workspace, p);
    const abs = resolve(options.workspace, rel);
    const s = await statMaybe(abs);
    if (!s) {
      before.set(rel, { beforeExists: false, beforeStored: false });
      continue;
    }

    if (s.size <= UNDO_CHECKPOINT_MAX_CONTENT_BYTES) {
      const bytes = await readFile(abs);
      before.set(rel, {
        beforeExists: true,
        beforeStored: true,
        beforeBytes: bytes,
        beforeHash: sha256Hex(bytes),
      });
      continue;
    }

    if (s.size <= UNDO_CHECKPOINT_MAX_HASH_BYTES) {
      const bytes = await readFile(abs);
      before.set(rel, { beforeExists: true, beforeStored: false, beforeHash: sha256Hex(bytes) });
      continue;
    }

    before.set(rel, { beforeExists: true, beforeStored: false });
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
    const captured = options.pending.before.get(rel) ?? { beforeExists: false, beforeStored: false };
    const afterStat = await statMaybe(abs);
    const afterExists = afterStat !== null;
    let afterStoredBytes: Uint8Array | undefined;
    let afterHash: string | undefined;

    if (afterStat && afterStat.size <= UNDO_CHECKPOINT_MAX_CONTENT_BYTES) {
      afterStoredBytes = await readFile(abs);
      afterHash = sha256Hex(afterStoredBytes);
    } else if (afterStat && afterStat.size <= UNDO_CHECKPOINT_MAX_HASH_BYTES) {
      const bytes = await readFile(abs);
      afterHash = sha256Hex(bytes);
    }

    const record: UndoCheckpointFile = {
      path: rel,
      beforeExists: captured.beforeExists,
      afterExists,
      beforeStored: captured.beforeStored,
      afterStored: afterStoredBytes !== undefined,
    };
    if (captured.beforeHash) record.beforeHash = captured.beforeHash;
    if (afterHash) record.afterHash = afterHash;
    files.push(record);

    if (captured.beforeStored && captured.beforeBytes) {
      const target = join(beforeDir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, captured.beforeBytes);
    }
    if (afterStoredBytes) {
      const target = join(afterDir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, afterStoredBytes);
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
  conflicts: Array<{
    path: string;
    reason:
      | "changed"
      | "missing_after_snapshot"
      | "missing_before_snapshot"
      | "unverifiable_after_snapshot"
      | "unverifiable_current";
  }>;
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
  const conflicts: UndoRestoreResult["conflicts"] = [];

  for (const file of meta.files) {
    if (!wanted.has(file.path)) continue;
    if (file.beforeExists && !file.beforeStored) {
      conflicts.push({ path: file.path, reason: "missing_before_snapshot" });
      continue;
    }

    // Verify current workspace state matches the snapshot we are undoing from.
    const abs = resolve(options.workspace, file.path);
    const currentStat = await statMaybe(abs);
    const currentExists = currentStat !== null;

    if (!file.afterExists) {
      if (currentExists) conflicts.push({ path: file.path, reason: "changed" });
      continue;
    }

    if (!currentExists) {
      conflicts.push({ path: file.path, reason: "changed" });
      continue;
    }
    if (!file.afterHash) {
      conflicts.push({ path: file.path, reason: "unverifiable_after_snapshot" });
      continue;
    }
    const currentHashed = await hashMaybeCapped(abs, UNDO_CHECKPOINT_MAX_HASH_BYTES);
    if (!currentHashed) {
      conflicts.push({ path: file.path, reason: "unverifiable_current" });
      continue;
    }
    if (currentHashed.hash !== file.afterHash) conflicts.push({ path: file.path, reason: "changed" });
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
