import { CodedError } from "./coded-error";
import { CLOUD_ERROR_CODES, errorMessage } from "./error-contract";
import { log } from "./log";
import type { MemoryStore } from "./memory-contract";
import { safeScopeKey, scopeFromKey } from "./memory-contract";
import type { SessionStore } from "./session-contract";

export type CloudMigrationSummary = {
  memories: number;
  sessions: number;
  failures: number;
  embeddingFailures: number;
};

export type CloudMigrationDeps = {
  localMemory: MemoryStore;
  localSessions: SessionStore;
  cloudMemory: MemoryStore;
  cloudSessions: SessionStore;
};

// Session-scoped records resolve to the running session's id, so a migrated one is unreachable
// from every future session: only project and user scopes survive the move.
function isDurable(scopeKey: string): boolean {
  return safeScopeKey(scopeKey) !== null && scopeFromKey(scopeKey) !== "session";
}

// A refused credential rejects every remaining write too, so it ends the run instead of counting
// itself once per record and reporting a copy that never had a chance.
export function isCredentialRejection(error: unknown): boolean {
  if (!(error instanceof CodedError)) return false;
  return error.code === CLOUD_ERROR_CODES.unauthorized || error.code === CLOUD_ERROR_CODES.forbidden;
}

function warnSkipped(event: string, id: string, error: unknown): void {
  log.warn(event, {
    id,
    code: error instanceof CodedError ? error.code : undefined,
    error: errorMessage(error),
  });
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
    sessions: 0,
    failures: 0,
    embeddingFailures: 0,
  };

  for (const record of records) {
    try {
      await deps.cloudMemory.write(record, scopeFromKey(record.scopeKey));
      summary.memories += 1;
    } catch (error) {
      if (isCredentialRejection(error)) throw error;
      warnSkipped("cloud.migrate.memory_failed", record.id, error);
      summary.failures += 1;
      continue;
    }
    // A record that landed without its vector is still recallable by keyword overlap, so the
    // embedding is counted apart from the record rather than discarding a successful copy.
    try {
      const embedding = await deps.localMemory.getEmbedding(record.id);
      if (embedding) await deps.cloudMemory.writeEmbedding(record.id, record.scopeKey, embedding);
    } catch (error) {
      if (isCredentialRejection(error)) throw error;
      warnSkipped("cloud.migrate.embedding_failed", record.id, error);
      summary.embeddingFailures += 1;
    }
  }

  for (const session of sessions) {
    try {
      await deps.cloudSessions.saveSession(session);
      summary.sessions += 1;
    } catch (error) {
      if (isCredentialRejection(error)) throw error;
      warnSkipped("cloud.migrate.session_failed", session.id, error);
      summary.failures += 1;
    }
  }

  return summary;
}
