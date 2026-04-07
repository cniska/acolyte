import { test } from "bun:test";
import type { SessionStore } from "./session-store";
import { sessionStoreContractTests } from "./session-store-contract.test-suite";
import { createPostgresSessionStore } from "./session-store-postgres";

const POSTGRES_TEST_URL = process.env.POSTGRES_TEST_URL;

if (!POSTGRES_TEST_URL) {
  test.skip("skipping Postgres session tests (POSTGRES_TEST_URL not set)", () => {});
} else {
  const url = POSTGRES_TEST_URL;
  const stores: SessionStore[] = [];

  async function createStore(): Promise<SessionStore> {
    const store = await createPostgresSessionStore(url);
    stores.push(store);
    return store;
  }

  async function cleanup(): Promise<void> {
    if (stores.length === 0) return;
    const postgres = (await import("postgres")).default;
    const sql = postgres(url);
    await sql`TRUNCATE sessions, session_preferences CASCADE`;
    await sql.end();
    for (const s of stores.splice(0)) s.close();
  }

  sessionStoreContractTests("Postgres", { create: createStore, cleanup });
}
