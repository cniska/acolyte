import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type DistillRecord, distillRecordSchema } from "./memory-contract";

export interface DistillStore {
  list(sessionId: string): Promise<readonly DistillRecord[]>;
  write(record: DistillRecord): Promise<void>;
}

function distillDir(homeDir: string, sessionId: string): string {
  return join(homeDir, ".acolyte", "distill", sessionId);
}

export function createFileDistillStore(homeDir = homedir()): DistillStore {
  return {
    async list(sessionId) {
      const dir = distillDir(homeDir, sessionId);
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
    async write(record) {
      const dir = distillDir(homeDir, record.sessionId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), "utf8");
    },
  };
}
