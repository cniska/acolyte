import type { MemoryStore } from "./memory-contract";
import { scopeFromKey } from "./memory-contract";
import type { SessionStore } from "./session-contract";

export type CloudMigrationSummary = {
  memories: number;
  embeddings: number;
  sessions: number;
  failures: number;
  embeddingFailures: number;
};

export type CloudMigrationDeps = {
  localMemory: MemoryStore;
  localSessions: SessionStore;
  cloudMemory: MemoryStore;
  cloudSessions: SessionStore;
  onProgress?: (done: number, total: number) => void;
};

// Session-scoped records resolve to the running session's id, so a migrated one is unreachable
// from every future session: only project and user scopes survive the move.
function isDurable(scopeKey: string): boolean {
  return scopeKey.startsWith("proj_") || scopeKey.startsWith("user_");
}

/**
 * Copies local memory and sessions into a cloud account. Every cloud write upserts on the record's
 * id, so an interrupted run is repaired by running it again rather than by tracking what landed.
 * The archive stays local: the cloud reaches an archive row only by retiring a live one, and that
 * write-then-retire pair is neither atomic nor repeatable.
 */
export async function migrateLocalDataToCloud(deps: CloudMigrationDeps): Promise<CloudMigrationSummary> {
  const records = (await deps.localMemory.list()).filter((record) => isDurable(record.scopeKey));
  const sessions = await deps.localSessions.listSessions();

  const summary: CloudMigrationSummary = {
    memories: 0,
    embeddings: 0,
    sessions: 0,
    failures: 0,
    embeddingFailures: 0,
  };
  const total = records.length + sessions.length;
  let done = 0;
  const advance = (): void => {
    done += 1;
    deps.onProgress?.(done, total);
  };

  for (const record of records) {
    try {
      await deps.cloudMemory.write(record, scopeFromKey(record.scopeKey));
      summary.memories += 1;
    } catch {
      summary.failures += 1;
      advance();
      continue;
    }
    // A record that landed without its vector is still recallable by keyword overlap, so the
    // embedding is counted apart from the record rather than discarding a successful copy.
    try {
      const embedding = await deps.localMemory.getEmbedding(record.id);
      if (embedding) {
        await deps.cloudMemory.writeEmbedding(record.id, record.scopeKey, embedding);
        summary.embeddings += 1;
      }
    } catch {
      summary.embeddingFailures += 1;
    }
    advance();
  }

  for (const session of sessions) {
    try {
      await deps.cloudSessions.saveSession(session);
      summary.sessions += 1;
    } catch {
      summary.failures += 1;
    }
    advance();
  }

  return summary;
}
