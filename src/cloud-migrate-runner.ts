import { CloudClient } from "./cloud-client";
import { type CloudMigrationSummary, migrateLocalDataToCloud } from "./cloud-migrate";
import { createSqliteMemoryStore } from "./memory-store";
import type { UserResourceId } from "./resource-id";
import { createFileSessionStore } from "./session-store";
import { mergeLocalUserScope, type UserScopeMergeSummary } from "./user-scope-merge";

/**
 * Opens the local stores directly rather than through their factories: the factories route to the
 * cloud once the flag is on, and `appConfig` reads credentials at import, so a login that just
 * wrote a token cannot resolve a client from configuration in its own process.
 */
export async function runCloudMigration(
  url: string,
  token: string,
  accountKey: UserResourceId,
): Promise<CloudMigrationSummary> {
  const localMemory = createSqliteMemoryStore();
  const localSessions = createFileSessionStore();
  const client = new CloudClient(url, token);

  try {
    return await migrateLocalDataToCloud({
      localMemory,
      localSessions,
      cloudMemory: client.memory,
      cloudSessions: client.session,
      accountKey,
    });
  } finally {
    localMemory.close();
    localSessions.close();
  }
}

export async function runUserScopeMerge(
  url: string,
  token: string,
  accountKey: UserResourceId,
): Promise<UserScopeMergeSummary> {
  const localMemory = createSqliteMemoryStore();
  const client = new CloudClient(url, token);

  try {
    return await mergeLocalUserScope({ localMemory, cloudMemory: client.memory, accountKey });
  } finally {
    localMemory.close();
  }
}
