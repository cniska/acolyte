import { CodedError } from "./coded-error";
import { concurrentMap } from "./concurrent-map";
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

// Each record costs a round trip for itself and another for its embedding, so a first login on a
// well-used machine is thousands of them. Held low enough that a copy stays a background nuisance
// rather than a burst the cloud reads as abuse.
const COPY_CONCURRENCY = 8;

export type CloudMigrationDeps = {
  localMemory: MemoryStore;
  localSessions: SessionStore;
  cloudMemory: MemoryStore;
  cloudSessions: SessionStore;
  accountKey: string;
};

// Session-scoped records resolve to the running session's id, so a migrated one is unreachable from
// every future session. A user-scoped record travels only when it is this account's own: the local
// scope is the merge's to move, and another account's key names a scope this one can never resolve.
function isDurable(scopeKey: string, accountKey: string): boolean {
  if (safeScopeKey(scopeKey) === null) return false;
  const scope = scopeFromKey(scopeKey);
  if (scope === "session") return false;
  return scope === "project" || scopeKey === accountKey;
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
 * Copies the first item on its own before fanning the rest out. A refused credential rejects every
 * write it is given, so proving one succeeded first is what keeps a bad token from queueing writes
 * it has no right to make.
 */
async function copyAll<T>(items: readonly T[], copy: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  await copy(items[0] as T);
  await concurrentMap(items.slice(1), COPY_CONCURRENCY, copy);
}

/**
 * Copies local memory and sessions into a cloud account. Every cloud write upserts on the record's
 * id, so an interrupted run is repaired by running it again rather than by tracking what landed.
 * The archive stays local: the cloud reaches an archive row only by retiring a live one, and that
 * write-then-retire pair is neither atomic nor repeatable.
 */
export async function migrateLocalDataToCloud(deps: CloudMigrationDeps): Promise<CloudMigrationSummary> {
  const records = (await deps.localMemory.list()).filter((record) => isDurable(record.scopeKey, deps.accountKey));
  const sessions = await deps.localSessions.listSessions();

  const summary: CloudMigrationSummary = {
    memories: 0,
    sessions: 0,
    failures: 0,
    embeddingFailures: 0,
  };

  await copyAll(records, async (record) => {
    try {
      await deps.cloudMemory.write(record, scopeFromKey(record.scopeKey));
      summary.memories += 1;
    } catch (error) {
      if (isCredentialRejection(error)) throw error;
      warnSkipped("cloud.migrate.memory_failed", record.id, error);
      summary.failures += 1;
      return;
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
  });

  await copyAll(sessions, async (session) => {
    try {
      await deps.cloudSessions.saveSession(session);
      summary.sessions += 1;
    } catch (error) {
      if (isCredentialRejection(error)) throw error;
      warnSkipped("cloud.migrate.session_failed", session.id, error);
      summary.failures += 1;
    }
  });

  return summary;
}
