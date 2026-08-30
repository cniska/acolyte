import { CloudClient } from "./cloud-client";
import { type CloudMigrationSummary, migrateLocalDataToCloud } from "./cloud-migrate";
import { createSqliteMemoryStore } from "./memory-store";
import { createFileSessionStore } from "./session-store";

/**
 * Opens the local stores directly rather than through their factories: the factories route to the
 * cloud once the flag is on, and `appConfig` reads credentials at import, so a login that just
 * wrote a token cannot resolve a client from configuration in its own process.
 */
export async function runCloudMigration(url: string, token: string): Promise<CloudMigrationSummary> {
  const localMemory = createSqliteMemoryStore();
  const localSessions = createFileSessionStore();
  const client = new CloudClient(url, token);

  try {
    return await migrateLocalDataToCloud({
      localMemory,
      localSessions,
      cloudMemory: client.memory,
      cloudSessions: client.session,
    });
  } finally {
    localMemory.close();
    localSessions.close();
  }
}
