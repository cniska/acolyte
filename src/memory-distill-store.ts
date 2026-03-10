import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type DistillRecord, distillRecordSchema } from "./memory-contract";

export interface DistillStore {
  list(scopeKey: string): Promise<readonly DistillRecord[]>;
  write(record: DistillRecord): Promise<void>;
  remove(id: string, scopeKey: string): Promise<void>;
}

function safeDistillScopeKey(scopeKey: string): string | null {
  return /^(sess|user|proj)_[a-z0-9_-]+$/.test(scopeKey) ? scopeKey : null;
}

function distillDir(homeDir: string, scopeKey: string): string | null {
  const safeName = safeDistillScopeKey(scopeKey);
  if (!safeName) return null;
  return join(homeDir, ".acolyte", "distill", safeName);
}

export function createFileDistillStore(homeDir = homedir()): DistillStore {
  return {
    async list(scopeKey) {
      const dir = distillDir(homeDir, scopeKey);
      if (!dir) return [];
      if (!existsSync(dir)) return [];
      const names = await readdir(dir);
      const records: DistillRecord[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(dir, name), "utf8");
          const parsed = distillRecordSchema.safeParse(JSON.parse(raw));
          if (parsed.success) records.push(parsed.data);
        } catch {
          // Ignore unreadable distill files.
        }
      }
      records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return records;
    },
    async remove(id, scopeKey) {
      const dir = distillDir(homeDir, scopeKey);
      if (!dir) return;
      await rm(join(dir, `${id}.json`), { force: true }).catch(() => {});
    },
    async write(record) {
      const dir = distillDir(homeDir, record.sessionId);
      if (!dir) return;
      await mkdir(dir, { recursive: true });
      const targetPath = join(dir, `${record.id}.json`);
      const tempPath = join(dir, `${record.id}.json.tmp-${process.pid}-${Date.now()}`);
      try {
        await writeFile(tempPath, JSON.stringify(record, null, 2), "utf8");
        await rename(tempPath, targetPath);
      } finally {
        await rm(tempPath, { force: true }).catch(() => {});
      }
    },
  };
}
